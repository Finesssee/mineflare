import { backendUrl, fetchApi } from '../client/utils/api';
import { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';

/**
 * ttyd WebSocket Protocol (Shared PTY Mode):
 *
 * Connection: Use subprotocol ['tty'], binary type 'arraybuffer'
 *
 * All messages are sent as binary (Uint8Array/ArrayBuffer).
 *
 * Client -> Server:
 *   - INPUT ('0'): Binary with first byte '0', followed by UTF-8 encoded input data
 *   - RESIZE_TERMINAL ('1'): IGNORED in shared PTY mode (server controls terminal size)
 *   - PAUSE ('2'): Binary UTF-8 encoding of '2'
 *   - RESUME ('3'): Binary UTF-8 encoding of '3'
 *   - SNAPSHOT_ACK ('4'): Client acknowledges snapshot receipt
 *
 * Server -> Client:
 *   - OUTPUT ('0'): Binary with first byte '0', followed by terminal output data
 *   - SET_WINDOW_TITLE ('1'): Binary with first byte '1', followed by UTF-8 title
 *   - SET_PREFERENCES ('2'): Binary with first byte '2', followed by preferences JSON
 *   - SNAPSHOT ('3'): Terminal state snapshot (JSON) - sent to late-joining clients
 *   - SESSION_RESIZE ('4'): Server-controlled terminal resize (JSON) - all clients must match
 *
 * Shared PTY Mode Notes:
 *   - Terminal dimensions are controlled by the server, not individual clients
 *   - FitAddon is disabled - use scrollable container instead
 *   - Late-joining clients receive a SNAPSHOT to sync with current terminal state
 *   - All clients share a single PTY process
 */

type TerminalType = 'claude' | 'codex' | 'gemini';

interface TerminalInstance {
  terminal: Terminal;
  ws: WebSocket | null;
  reconnectAttempts: number;
  reconnectTimeout: NodeJS.Timeout | null;
  connected: boolean;
  sessionColumns: number | undefined;
  sessionRows: number | undefined;
  suppressResize: boolean;
}

// Terminal configuration
const terminalConfig = {
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"Cascadia Code", "Fira Code", "Courier New", monospace',
    theme: {
        background: '#0a1612',
        foreground: '#e0e0e0',
        cursor: '#55FF55',
        cursorAccent: '#0a1612',
        selectionBackground: '#57A64E',
        black: '#0a1612',
        red: '#ff6b6b',
        green: '#55FF55',
        yellow: '#FFB600',
        blue: '#5B9BD5',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#e0e0e0',
        brightBlack: '#4d5a5e',
        brightRed: '#ff8787',
        brightGreen: '#7cbc73',
        brightYellow: '#ffd454',
        brightBlue: '#82c4e5',
        brightMagenta: '#d89ae8',
        brightCyan: '#7ec9d4',
        brightWhite: '#ffffff'
    },
    allowProposedApi: true
};

// Create terminal instances
const terminals: Record<TerminalType, TerminalInstance> = {
  claude: createTerminalInstance('claude'),
  codex: createTerminalInstance('codex'),
  gemini: createTerminalInstance('gemini')
};

const statusEl = document.getElementById('connection-status')!;
const maxReconnectAttempts = 10;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let currentTerminal: TerminalType = 'claude';

/**
 * Handle SESSION_RESIZE command from server (command '4')
 * Server controls terminal dimensions in shared PTY mode
 */
function handleSessionResize(type: TerminalType, instance: TerminalInstance, jsonData: Uint8Array) {
  const { columns, rows } = JSON.parse(textDecoder.decode(jsonData));

  console.log(`${type}: Server set terminal size: ${columns}x${rows}`);

  instance.sessionColumns = columns;
  instance.sessionRows = rows;

  // Resize terminal without triggering client-side resize events
  instance.suppressResize = true;
  try {
    instance.terminal.resize(columns, rows);
  } finally {
    instance.suppressResize = false;
  }
}

/**
 * Terminal mode flags from libtsm (screen state)
 */
const ScreenFlag = {
  INSERT_MODE: 0x01,
  AUTO_WRAP: 0x02,
  REL_ORIGIN: 0x04,
  INVERSE: 0x08,
  HIDE_CURSOR: 0x10,
  ALTERNATE: 0x40,
} as const;

/**
 * Terminal mode flags from libtsm (VTE state)
 */
const VteFlag = {
  CURSOR_KEY_MODE: 0x0001,
  KEYPAD_APPLICATION_MODE: 0x0002,
  TEXT_CURSOR_MODE: 0x0200,
  INVERSE_SCREEN_MODE: 0x0400,
  ORIGIN_MODE: 0x0800,
  AUTO_WRAP_MODE: 0x1000,
} as const;

/**
 * Snapshot payload structure from ttyd
 */
interface SnapshotPayload {
  lines: string[];
  cursor_x: number;
  cursor_y: number;
  screen_flags?: number;
  vte_flags?: number;
}

/**
 * Apply terminal modes from snapshot flags
 * This restores alternate screen, cursor visibility, keypad modes, etc.
 * so that Ratatui UIs (like Codex) maintain their state across reconnects.
 */
function applySnapshotModes(term: Terminal, snapshot: SnapshotPayload) {
  let seq = '';

  const setDecPrivate = (code: number, enable?: boolean) => {
    if (enable === undefined) return;
    seq += `\x1b[?${code}${enable ? 'h' : 'l'}`;
  };
  const setMode = (code: number, enable?: boolean) => {
    if (enable === undefined) return;
    seq += `\x1b[${code}${enable ? 'h' : 'l'}`;
  };

  const screen = snapshot.screen_flags ?? 0;
  const vte = snapshot.vte_flags ?? 0;

  const altScreen = (screen & ScreenFlag.ALTERNATE) !== 0;
  const showCursor = snapshot.screen_flags !== undefined
    ? (screen & ScreenFlag.HIDE_CURSOR) === 0
    : (vte & VteFlag.TEXT_CURSOR_MODE) !== 0;
  const inverse = ((screen & ScreenFlag.INVERSE) !== 0) || ((screen === 0) && ((vte & VteFlag.INVERSE_SCREEN_MODE) !== 0));
  const insertMode = (screen & ScreenFlag.INSERT_MODE) !== 0;
  const originMode = (vte & VteFlag.ORIGIN_MODE) !== 0;
  const autoWrap = ((screen & ScreenFlag.AUTO_WRAP) !== 0) || ((vte & VteFlag.AUTO_WRAP_MODE) !== 0);
  const cursorKeys = (vte & VteFlag.CURSOR_KEY_MODE) !== 0;
  const keypadApp = (vte & VteFlag.KEYPAD_APPLICATION_MODE) !== 0;

  setDecPrivate(1049, altScreen);
  setDecPrivate(25, showCursor);
  setDecPrivate(5, inverse);
  setMode(4, insertMode);
  setDecPrivate(6, originMode);
  setDecPrivate(7, autoWrap);
  setDecPrivate(1, cursorKeys);
  seq += keypadApp ? '\x1b=' : '\x1b>';

  if (seq) {
    term.write(seq);
  }
}

/**
 * Handle SNAPSHOT command from server (command '3')
 * Late-joining clients receive current terminal state
 * 
 * CRITICAL: Always send SNAPSHOT_ACK even if parsing/rendering fails.
 * Without the ACK, the server keeps the PTY paused and reconnecting clients
 * remain stuck with a frozen terminal.
 */
function handleSnapshot(type: TerminalType, instance: TerminalInstance, jsonData: Uint8Array) {
  const ack = new Uint8Array([0x34]); // '4' = SNAPSHOT_ACK
  let ackSent = false;

  try {
    const snapshot: SnapshotPayload = JSON.parse(textDecoder.decode(jsonData));

    console.log(`${type}: Applying snapshot: ${snapshot.lines.length} lines, ` +
                `cursor at (${snapshot.cursor_x}, ${snapshot.cursor_y}), ` +
                `screen_flags: ${snapshot.screen_flags?.toString(16) ?? 'none'}, ` +
                `vte_flags: ${snapshot.vte_flags?.toString(16) ?? 'none'}`);

    // Apply terminal modes BEFORE clearing screen
    // This ensures alternate screen, cursor visibility, keypad modes, etc. are restored
    applySnapshotModes(instance.terminal, snapshot);

    // Clear screen and home cursor
    instance.terminal.write('\x1b[2J\x1b[H');

    // Render each line using ANSI positioning
    for (let i = 0; i < snapshot.lines.length; i++) {
      if (snapshot.lines[i].length > 0) {
        // Position cursor at row (1-indexed) and write the line
        instance.terminal.write(`\x1b[${i + 1};1H${snapshot.lines[i]}`);
      }
    }

    // Position cursor at saved location (convert 0-indexed to 1-indexed)
    const row = snapshot.cursor_y + 1;
    const col = snapshot.cursor_x + 1;
    instance.terminal.write(`\x1b[${row};${col}H`);

    // Send SNAPSHOT_ACK to server (command '4')
    instance.ws?.send(ack);
    ackSent = true;

    console.log(`${type}: Snapshot applied successfully, sent ACK`);
  } catch (err) {
    console.error(`${type}: Failed to apply snapshot`, err);
  } finally {
    // Guarantee ACK is sent even if snapshot processing failed
    if (!ackSent && instance.ws?.readyState === WebSocket.OPEN) {
      instance.ws.send(ack);
      console.log(`${type}: Sent SNAPSHOT_ACK after recoverable error`);
    }
  }
}

// API Key management
const API_KEY_STORAGE_KEY = 'mineflare_gemini_api_key';
let pendingTerminalSwitch: TerminalType | null = null;

// Update tab visual state based on connection status
function updateTabConnectionState(type: TerminalType, state: 'connected' | 'connecting' | 'disconnected') {
  const tab = document.querySelector(`.tab[data-terminal="${type}"]`);
  if (!tab) return;
  
  // Remove all connection state classes
  tab.classList.remove('connected', 'connecting', 'disconnected');
  
  // Add the current state
  if (state !== 'disconnected') {
    tab.classList.add(state);
  }
}

function createTerminalInstance(type: TerminalType): TerminalInstance {
  const terminal = new Terminal(terminalConfig);

  const webLinksAddon = new WebLinksAddon();
  terminal.loadAddon(webLinksAddon);

  const element = document.getElementById(`terminal-${type}`)!;

  // Enable scrolling for shared PTY mode (since we can't resize to fit)
  element.style.overflow = 'auto';

  terminal.open(element);

  return {
    terminal,
    ws: null,
    reconnectAttempts: 0,
    reconnectTimeout: null,
    connected: false,
    sessionColumns: undefined,
    sessionRows: undefined,
    suppressResize: false
  };
}

function showStatus(message: string, type: string) {
  statusEl.textContent = message;
  statusEl.className = type;
  statusEl.style.display = 'block';

    if (type === 'connected') {
        setTimeout(() => {
      statusEl.style.display = 'none';
        }, 3000);
    }
}

async function connect(type: TerminalType) {
  const instance = terminals[type];
  
  // SINGLETON: If we have an active connection, reuse it
  if (instance.ws) {
    const state = instance.ws.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
      console.log(`${type}: Reusing existing WebSocket connection (state: ${state})`);
      return;
    }
  }
  
  // Clear any existing reconnect timeout
  if (instance.reconnectTimeout) {
    clearTimeout(instance.reconnectTimeout);
    instance.reconnectTimeout = null;
  }

  // Update tab state to connecting
  updateTabConnectionState(type, 'connecting');
  
  if (type === currentTerminal) {
    showStatus(`Connecting to ${type}...`, 'connecting');
  }
  
  console.log(`${type}: Creating new WebSocket connection...`);

    try {
        // Fetch WebSocket token
        const tokenResponse = await fetchApi('/auth/ws-token', {
            credentials: 'include',
        });
        if (!tokenResponse.ok) {
            console.error('Failed to get WebSocket token, status:', tokenResponse.status);
      if (type === currentTerminal) {
            showStatus('Authentication failed', 'error');
      }
            return;
        }

        const { token } = await tokenResponse.json() as { token: string };

        // Determine WebSocket protocol (ws or wss)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const backend = new URL(backendUrl(`/src/terminal/${type}/ws`));
        backend.protocol = protocol;
        
        // Add token as query parameter
        backend.searchParams.set('token', token);
        const wsUrl = backend.toString();

    console.log(`Connecting ${type} to:`, wsUrl);

        // ttyd uses the "tty" subprotocol
    instance.ws = new WebSocket(wsUrl, ['tty']);
    instance.ws.binaryType = 'arraybuffer';

    instance.ws.onopen = () => {
      console.log(`${type} WebSocket connected - Shared PTY mode`);
      instance.connected = true;
      instance.reconnectAttempts = 0;

      // Update tab visual state
      updateTabConnectionState(type, 'connected');

      if (type === currentTerminal) {
        showStatus(`Connected to ${type}`, 'connected');
      }

      // Send initial JSON handshake that ttyd expects on every connection
      // This triggers create_shared_process() on the server
      const handshake = {
        columns: instance.terminal.cols,
        rows: instance.terminal.rows
      };
      instance.ws?.send(JSON.stringify(handshake));
      console.log(`${type}: Sent initial handshake:`, handshake);

      // In shared PTY mode, the server will send SESSION_RESIZE to set terminal dimensions
      // after creating the shared process

      // Initialize Gemini settings if this is the first connection
      if (type === 'gemini' && !geminiInitialized) {
        const apiKey = getGeminiApiKey();
        if (apiKey) {
          geminiInitialized = true;
          initializeGeminiSettings(instance, apiKey);
        }
      }
    };

    instance.ws.onmessage = (event) => {
      // Handle ttyd protocol messages
      if (event.data instanceof ArrayBuffer) {
        const data = new Uint8Array(event.data);
        if (data.length === 0) return;

        // First byte is the command type
        const cmd = String.fromCharCode(data[0]);
        const textDecoder = new TextDecoder();

        if (cmd === '0') {
          // OUTPUT: Write the rest of the data to terminal
          if (data.length > 1) {
            instance.terminal.write(data.subarray(1));
          }
        } else if (cmd === '1') {
          // SET_WINDOW_TITLE
          const title = textDecoder.decode(data.subarray(1));
          if (type === currentTerminal) {
            document.title = title;
          }
        } else if (cmd === '2') {
          // SET_PREFERENCES
          const prefs = JSON.parse(textDecoder.decode(data.subarray(1)));
          console.log(`${type} received preferences:`, prefs);
          // Apply preferences to terminal
          Object.assign(instance.terminal.options, prefs);
        } else if (cmd === '3') {
          // SNAPSHOT: Terminal state for late-joining clients
          handleSnapshot(type, instance, data.subarray(1));
        } else if (cmd === '4') {
          // SESSION_RESIZE: Server-controlled terminal resize
          handleSessionResize(type, instance, data.subarray(1));
        }
      }
    };

    instance.ws.onerror = (error) => {
      console.error(`${type} WebSocket error:`, error);
      if (type === currentTerminal) {
            showStatus('Connection error', 'error');
      }
    };

    instance.ws.onclose = (event) => {
      console.log(`${type} WebSocket closed:`, event.code, event.reason);
      instance.connected = false;
      
      // Update tab visual state
      updateTabConnectionState(type, 'disconnected');

      if (instance.reconnectAttempts < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, instance.reconnectAttempts), 30000);
        instance.reconnectAttempts++;
        
        // Update tab to connecting state
        updateTabConnectionState(type, 'connecting');
        
        if (type === currentTerminal) {
          showStatus(`Reconnecting ${type}... (${instance.reconnectAttempts}/${maxReconnectAttempts})`, 'connecting');
        }

        instance.reconnectTimeout = setTimeout(() => {
          connect(type);
        }, delay);
      } else {
        if (type === currentTerminal) {
          showStatus('Connection lost. Refresh to reconnect.', 'error');
        }
        instance.terminal.write('\r\n\x1b[1;31mConnection lost. Please refresh the page to reconnect.\x1b[0m\r\n');
      }
    };
    } catch (error) {
      console.error(`Failed to establish ${type} connection:`, error);
      
      // Update tab state
      updateTabConnectionState(type, 'disconnected');
      
      if (type === currentTerminal) {
        showStatus('Failed to connect', 'error');
      }
      
      // Retry connection if we haven't exceeded max attempts
      if (instance.reconnectAttempts < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, instance.reconnectAttempts), 30000);
        instance.reconnectAttempts++;
        
        // Update tab to connecting for retry
        updateTabConnectionState(type, 'connecting');
        
        instance.reconnectTimeout = setTimeout(() => {
          connect(type);
        }, delay);
      }
    }
}

// Track data handlers to prevent duplicate setup
const dataHandlersSetup: Set<TerminalType> = new Set();

function setupTerminalDataHandler(type: TerminalType) {
  if (dataHandlersSetup.has(type)) return;
  
  const instance = terminals[type];
  instance.terminal.onData((data) => {
    // Only send data if this is the current terminal and WebSocket is open
    if (type === currentTerminal && instance.ws && instance.ws.readyState === WebSocket.OPEN) {
      // Filter out terminal initialization/query sequences that xterm.js might send
      // These are not user input and can confuse the shell
      
      // Check for ESC sequences (0x1B)
      if (data.includes('\x1B')) {
        // Filter OSC (Operating System Command) sequences - typically \x1B]
        if (data.includes('\x1B]')) {
          console.log(`Filtered OSC sequence from ${type}`);
          return;
        }
        
        // Filter CSI (Control Sequence Introducer) queries - \x1B[
        if (data.includes('\x1B[') && (data.includes('c') || data.includes('n'))) {
          console.log(`Filtered CSI query from ${type}`);
          return;
        }
      }
      
      // Filter standalone color query responses (like "10;rgb:...")
      if (data.match(/^\d+;rgb:/)) {
        console.log(`Filtered color query response from ${type}`);
        return;
      }
      
        // Send input using ttyd protocol: binary with first byte '0' (INPUT)
        const encoded = textEncoder.encode(data);
        const message = new Uint8Array(encoded.length + 1);
        message[0] = '0'.charCodeAt(0); // INPUT command
        message.set(encoded, 1);
      instance.ws.send(message);
    }
  });
  
  dataHandlersSetup.add(type);
}

// Setup data handler for Claude (initially visible)
setupTerminalDataHandler('claude');

// Handle paste events on terminal containers
// This allows CMD+V/Ctrl+V to work while letting Ctrl+C pass through to the terminal
function setupPasteHandler(type: TerminalType) {
  const element = document.getElementById(`terminal-${type}`)!;
  
  element.addEventListener('paste', async (e) => {
    const instance = terminals[type];
    
    // Only handle paste if this terminal is active and connected
    if (type !== currentTerminal) return;
    if (!instance.ws || instance.ws.readyState !== WebSocket.OPEN) return;
    
    // Prevent default to avoid interference
    e.preventDefault();
    
    // Get clipboard data
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;
    
    const text = clipboardData.getData('text/plain');
    if (!text) return;
    
    console.log(`${type}: Pasting ${text.length} characters`);
    
    // Send through terminal's onData to ensure proper handling
    // This will trigger our data handler which sends to WebSocket
    instance.terminal.paste(text);
  });
}

// Setup paste handlers for all terminals
setupPasteHandler('claude');
setupPasteHandler('codex');
setupPasteHandler('gemini');

// In shared PTY mode, terminal resizing is controlled by the server
// Window resize events don't trigger terminal resizes - the container scrolls instead

// API Key Modal Management
const modalOverlay = document.getElementById('modal-overlay')!;
const apiKeyInput = document.getElementById('gemini-api-key') as HTMLInputElement;
const modalSaveBtn = document.getElementById('modal-save')!;
const modalCancelBtn = document.getElementById('modal-cancel')!;

function getGeminiApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

function setGeminiApiKey(key: string) {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

function showApiKeyModal() {
  modalOverlay.classList.add('active');
  apiKeyInput.value = getGeminiApiKey() || '';
  apiKeyInput.focus();
}

function hideApiKeyModal() {
  modalOverlay.classList.remove('active');
  apiKeyInput.value = '';
}

function initializeGeminiSettings(instance: TerminalInstance, apiKey: string) {
  // Wait for terminal to be ready, then send commands to set up Gemini
  const commands = [
    `mkdir -p /data/.gemini\n`,
    `cat > /data/.gemini/settings.json << 'GEMINI_EOF'\n`,
    `{\n`,
    `  "apiKey": "${apiKey}"\n`,
    `}\n`,
    `GEMINI_EOF\n`,
    `export GEMINI_API_KEY="${apiKey}"\n`,
    `clear\n`,
    `echo "✨ Gemini API key configured successfully!"\n`,
    `echo "You can now use Gemini. Try typing your first prompt."\n`,
    `echo ""\n`
  ];

  // Send commands after a short delay to ensure connection is established
  setTimeout(() => {
    commands.forEach((cmd, index) => {
      setTimeout(() => {
        if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
          const encoded = textEncoder.encode(cmd);
          const message = new Uint8Array(encoded.length + 1);
          message[0] = '0'.charCodeAt(0);
          message.set(encoded, 1);
          instance.ws.send(message);
        }
      }, index * 50); // Small delay between commands
    });
  }, 500);
}

// Modal event handlers
modalSaveBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    apiKeyInput.focus();
    return;
  }
  
  setGeminiApiKey(apiKey);
  hideApiKeyModal();
  
  // If there was a pending terminal switch, complete it now
  if (pendingTerminalSwitch === 'gemini') {
    pendingTerminalSwitch = null;
    doSwitchTerminal('gemini');
  }
});

modalCancelBtn.addEventListener('click', () => {
  hideApiKeyModal();
  pendingTerminalSwitch = null;
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
    hideApiKeyModal();
    pendingTerminalSwitch = null;
  }
});

// Allow Enter key to save
apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    modalSaveBtn.click();
  }
});

// Handle tab switching
const tabs = document.querySelectorAll('.tab');
const terminalWrappers = document.querySelectorAll('.terminal-wrapper');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const terminalType = tab.getAttribute('data-terminal') as TerminalType;
    switchTerminal(terminalType);
  });
});

function switchTerminal(type: TerminalType) {
  // Check if Gemini requires API key
  if (type === 'gemini' && !getGeminiApiKey()) {
    pendingTerminalSwitch = type;
    showApiKeyModal();
    return;
  }
  
  doSwitchTerminal(type);
}

function doSwitchTerminal(type: TerminalType) {
  if (type === currentTerminal) return;
  
  // Setup data handler for this terminal if not already done
  setupTerminalDataHandler(type);
  
  // Update active tab
  tabs.forEach(tab => {
    if (tab.getAttribute('data-terminal') === type) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // Update active terminal wrapper
  terminalWrappers.forEach(wrapper => {
    if (wrapper.getAttribute('data-terminal') === type) {
      wrapper.classList.add('active');
    } else {
      wrapper.classList.remove('active');
    }
  });
  
  currentTerminal = type;

  // Focus the new terminal
  terminals[type].terminal.focus();

  // In shared PTY mode, terminal dimensions are controlled by server
  // No need to fit or send resize commands

  // SINGLETON PATTERN: Check existing connection state before creating new one
  const instance = terminals[type];
  if (!instance.ws || instance.ws.readyState === WebSocket.CLOSED || instance.ws.readyState === WebSocket.CLOSING) {
    console.log(`🔌 ${type}: No active connection, initiating new connection...`);
    connect(type);
  } else if (instance.ws.readyState === WebSocket.OPEN) {
    console.log(`♻️ ${type}: REUSING existing connected WebSocket - singleton pattern working!`);
    updateTabConnectionState(type, 'connected');
    showStatus(`Connected to ${type}`, 'connected');
  } else if (instance.ws.readyState === WebSocket.CONNECTING) {
    console.log(`⏳ ${type}: Connection already in progress, waiting...`);
    updateTabConnectionState(type, 'connecting');
    showStatus(`Connecting to ${type}...`, 'connecting');
  }
}

// Track if Gemini has been initialized
let geminiInitialized = false;

// Focus initial terminal
terminals.claude.terminal.focus();

// Start connection to the current (claude) terminal
connect('claude');

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  Object.values(terminals).forEach(instance => {
    if (instance.ws) {
      instance.ws.close();
    }
  });
});
