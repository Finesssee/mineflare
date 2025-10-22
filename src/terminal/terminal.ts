import { backendUrl, fetchWithAuth } from '../client/utils/api';
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

type TerminalType = 'claude' | 'codex' | 'gemini' | 'bash' | 'browser';
type ActualTerminalType = 'claude' | 'codex' | 'gemini' | 'bash';

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

// Create terminal instances (browser is handled separately as an iframe)
const terminals: Record<ActualTerminalType, TerminalInstance> = {
  claude: createTerminalInstance('claude'),
  codex: createTerminalInstance('codex'),
  gemini: createTerminalInstance('gemini'),
  bash: createTerminalInstance('bash')
};

const statusEl = document.getElementById('connection-status')!;
const maxReconnectAttempts = 10;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let currentTerminal: TerminalType = 'claude';

// URL detection
interface DetectedUrl {
  url: string;
  timestamp: number;
  terminal: TerminalType;
}

const detectedUrls: Map<string, DetectedUrl> = new Map();
const urlBuffer: Map<TerminalType, string> = new Map();

// Terminal width (set in start-with-services.sh)
const TERMINAL_WIDTH = 160;

// URL regex - matches common URL patterns including query strings
// Excludes: whitespace, brackets, quotes, pipes, backslashes
// Includes: ? & = # / : and other valid URL characters
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\]]+/g;

/**
 * Unwrap URLs that have been split across multiple lines due to terminal width
 * When a URL wraps, it typically breaks at the terminal width (160 chars)
 * and continues on the next line without indentation
 * 
 * Example: Codex OAuth URLs often wrap like this:
 *   https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&s
 *   cope=openid%20profile%20email%20offline_access&code_challenge=x-qBkaOce633yfYHuwrcqH6HELMQFCBC_UDCgkHAi_k&code_challenge_method=S256&id_token_add_organizations=
 *   true&codex_cli_simplified_flow=true&state=67ujqV52l8vfM71GNpXEIWjYwcez3ZHrTw1YpsVjyEo&originator=codex_cli_rs
 * 
 * This function rejoins these fragments into a single valid URL
 */
function unwrapUrls(text: string): string {
  const lines = text.split('\n');
  const unwrapped: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];
    const nextLine = lines[i + 1];
    
    // Check if this line might be part of a wrapped URL
    if (nextLine !== undefined) {
      // Look for URL pattern at the end of current line
      const urlEndMatch = currentLine.match(/https?:\/\/[^\s<>"{}|\\^`\]]*$/);
      
      if (urlEndMatch) {
        // Check if next line continues with valid URL characters (no http:// prefix)
        const urlContinueMatch = nextLine.match(/^[^\s<>"{}|\\^`\]]+/);
        
        if (urlContinueMatch && !nextLine.startsWith('http://') && !nextLine.startsWith('https://')) {
          // This looks like a wrapped URL - join the lines
          unwrapped.push(currentLine + nextLine);
          i++; // Skip the next line since we've already processed it
          continue;
        }
      } else {
        // Check if current line ends with URL characters (continuation from previous)
        const urlPartMatch = currentLine.match(/^[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/);
        
        if (urlPartMatch && unwrapped.length > 0) {
          const prevLine = unwrapped[unwrapped.length - 1];
          // Check if previous line has a URL in it
          if (prevLine.match(/https?:\/\//)) {
            // Join with previous line
            unwrapped[unwrapped.length - 1] = prevLine + currentLine;
            continue;
          }
        }
      }
    }
    
    unwrapped.push(currentLine);
  }
  
  return unwrapped.join('\n');
}

/**
 * Extract and track URLs from terminal output
 */
function detectUrls(type: TerminalType, text: string) {
  const decoder = new TextDecoder();
  const content = typeof text === 'string' ? text : decoder.decode(text);

  // Add to buffer for multi-line detection
  const currentBuffer = (urlBuffer.get(type) || '') + content;
  urlBuffer.set(type, currentBuffer);

  // Keep buffer manageable (last 10KB)
  if (currentBuffer.length > 10240) {
    urlBuffer.set(type, currentBuffer.slice(-10240));
  }

  // Unwrap URLs that have been split across lines
  const unwrappedBuffer = unwrapUrls(currentBuffer);

  // Extract URLs from unwrapped buffer
  const matches = unwrappedBuffer.matchAll(URL_REGEX);
  for (const match of matches) {
    let url = match[0];

    // Clean up common terminal artifacts
    url = url.replace(/\x1b\[[0-9;]*[mGKH]/g, ''); // Remove ANSI codes
    url = url.replace(/[\x00-\x1f\x7f]/g, ''); // Remove control characters
    url = url.replace(/[,;.:!?]$/, ''); // Remove trailing punctuation

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        addDetectedUrl(type, url);
      }
    } catch (e) {
      // Invalid URL, skip
    }
  }
}

/**
 * Scan the current terminal buffer for URLs
 * This is used when switching terminals or manually refreshing
 */
function scanTerminalForUrls(type: ActualTerminalType) {
  try {
    const instance = terminals[type];
    if (!instance || !instance.terminal) {
      return;
    }

    const buffer = instance.terminal.buffer.active;
    let content = '';
    
    // Read all lines from the terminal buffer
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        content += line.translateToString(true) + '\n';
      }
    }
    
    // Detect URLs in the scanned content
    if (content.trim()) {
      detectUrls(type, content);
    }
  } catch (error) {
    console.error(`Failed to scan terminal ${type} for URLs:`, error);
  }
}

/**
 * Add URL to detected list and update UI
 */
function addDetectedUrl(type: TerminalType, url: string) {
  if (!detectedUrls.has(url)) {
    detectedUrls.set(url, {
      url,
      timestamp: Date.now(),
      terminal: type
    });
    updateUrlPanel();
  }
}

/**
 * Update the URL panel in the UI
 * Only shows URLs from the current terminal
 */
function updateUrlPanel() {
  const panel = document.getElementById('detected-urls-list');
  if (!panel) return;

  // Filter URLs to only show those from the current terminal
  const urls = Array.from(detectedUrls.values())
    .filter(item => item.terminal === currentTerminal)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10); // Keep last 10 URLs

  if (urls.length === 0) {
    const terminalName = currentTerminal === 'claude' ? 'Claude' : 
                        currentTerminal === 'codex' ? 'Codex' : 
                        currentTerminal === 'gemini' ? 'Gemini' : 
                        currentTerminal === 'bash' ? 'Bash' :
                        currentTerminal === 'browser' ? 'Browser' : currentTerminal;
    panel.innerHTML = `<div class="no-urls">No URLs detected in ${terminalName} terminal.<br>URLs will appear here as they are output.</div>`;
    return;
  }

  panel.innerHTML = urls.map(({ url }) => {
    return `
      <div class="detected-url-item">
        <a href="#" class="detected-url-link" data-url="${escapeHtml(url)}" data-action="open">
          ${escapeHtml(url)}
        </a>
        <button class="url-copy-btn" data-url="${escapeHtml(url)}" title="Copy URL">📋</button>
      </div>
    `;
  }).join('');

  // Add click handlers for opening URLs in browser
  panel.querySelectorAll('.detected-url-link').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const url = (link as HTMLElement).dataset.url;
      if (url) {
        await openUrlInBrowser(url);
      }
    });
  });

  // Add copy button handlers
  panel.querySelectorAll('.url-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = (btn as HTMLElement).dataset.url;
      if (url) {
        navigator.clipboard.writeText(url).then(() => {
          const originalText = btn.textContent;
          btn.textContent = '✓';
          setTimeout(() => btn.textContent = originalText, 1000);
        });
      }
    });
  });
}

/**
 * Simple HTML escape to prevent XSS
 */
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Open a URL in the embedded browser and switch to browser tab
 */
async function openUrlInBrowser(url: string) {
  try {
    // Switch to browser tab FIRST so user sees the browser immediately
    console.log('Switching to browser tab and navigating to:', url);
    switchTerminal('browser');
    
    // Show status
    showStatus('Opening URL in browser...', 'connecting');
    
    // Call the browser navigation API
    const response = await fetchWithAuth('/api/browser/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to navigate: ${response.statusText}`);
    }
    
    const result = await response.json() as { success: boolean; error?: string };
    
    if (result.success) {
      console.log('Browser navigation successful');
      showStatus('Browser navigated (Chrome restarting...)', 'connected');
    } else {
      console.error('Browser navigation failed:', result.error);
      showStatus(`Navigation failed: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Failed to open URL in browser:', error);
    showStatus('Failed to open URL', 'error');
  }
}

/**
 * Clear URLs for a specific terminal
 */
function clearUrlsForTerminal(type: TerminalType) {
  for (const [url, info] of detectedUrls.entries()) {
    if (info.terminal === type) {
      detectedUrls.delete(url);
    }
  }
  urlBuffer.delete(type);
  updateUrlPanel();
}

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

    // Scan snapshot lines for URLs
    // This is important for detecting URLs when first switching to a terminal
    if (type !== 'browser') {
      const content = snapshot.lines.join('\n');
      if (content.trim()) {
        detectUrls(type, content);
      }
    }
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

function createTerminalInstance(type: ActualTerminalType): TerminalInstance {
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

async function connect(type: ActualTerminalType) {
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
        const tokenResponse = await fetchWithAuth('/auth/ws-token', {
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

      // Ensure terminal has focus so the helper textarea captures paste
      if (type === currentTerminal) {
        instance.terminal.focus();
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
            const output = data.subarray(1);
            instance.terminal.write(output);

            // Detect URLs in the output
            const outputText = textDecoder.decode(output);
            detectUrls(type, outputText);
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
const dataHandlersSetup: Set<ActualTerminalType> = new Set();

function setupTerminalDataHandler(type: ActualTerminalType) {
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

// Fallback: route clipboard paste to the active terminal when its helper isn't focused
// This helps in cases where focus was lost during tab switches (e.g., Gemini flow)
document.addEventListener('paste', (event) => {
  const activeEl = document.activeElement as HTMLElement | null;
  
  // Don't intercept paste if xterm has focus
  if (activeEl && activeEl.classList && activeEl.classList.contains('xterm-helper-textarea')) {
    return; // xterm has focus; let it handle paste natively
  }

  // Don't intercept paste if a form input/textarea has focus (e.g., API key modal)
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
    return; // Let the input handle paste normally
  }

  // Don't intercept paste if modal is active
  const modalOverlay = document.getElementById('modal-overlay');
  if (modalOverlay && modalOverlay.classList.contains('active')) {
    return; // Modal is open, don't intercept
  }

  const type = currentTerminal;
  if (type === 'browser') return;
  const instance = terminals[type as ActualTerminalType];
  if (!instance || !instance.ws || instance.ws.readyState !== WebSocket.OPEN) return;

  const clipboardData = (event.clipboardData || (window as any).clipboardData);
  const text = clipboardData?.getData('text/plain');
  if (!text) return;

  event.preventDefault();

  const encoded = textEncoder.encode(text);
  const message = new Uint8Array(encoded.length + 1);
  message[0] = '0'.charCodeAt(0);
  message.set(encoded, 1);
  instance.ws.send(message);
});

// Setup data handler for Claude (initially visible)
setupTerminalDataHandler('claude');

// xterm.js handles paste events natively through its onData handler
// No custom paste handling needed - CMD+V/Ctrl+V work out of the box

// In shared PTY mode, terminal resizing is controlled by the server
// Window resize events don't trigger terminal resizes - the container scrolls instead

// Refresh URLs button handler - scans current terminal for URLs
const refreshUrlsBtn = document.getElementById('refresh-urls-btn');
if (refreshUrlsBtn) {
  refreshUrlsBtn.addEventListener('click', () => {
    if (currentTerminal !== 'browser') {
      console.log(`Scanning ${currentTerminal} terminal for URLs...`);
      scanTerminalForUrls(currentTerminal as ActualTerminalType);
      showStatus(`Scanned ${currentTerminal} terminal`, 'connected');
    }
  });
}

// Clear URLs button handler - clears all URLs
const clearUrlsBtn = document.getElementById('clear-urls-btn');
if (clearUrlsBtn) {
  clearUrlsBtn.addEventListener('click', () => {
    detectedUrls.clear();
    urlBuffer.clear();
    updateUrlPanel();
    showStatus('Cleared all URLs', 'connected');
  });
}

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
  doSwitchTerminal(type);
}

function doSwitchTerminal(type: TerminalType) {
  if (type === currentTerminal) return;
  
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

  // Update URL panel to show URLs from new terminal
  updateUrlPanel();

  // Browser tab doesn't need terminal setup
  if (type === 'browser') {
    updateTabConnectionState(type, 'connected');
    showStatus('Browser ready', 'connected');
    return;
  }

  // Scan the terminal buffer for URLs when switching
  scanTerminalForUrls(type);

  // Setup data handler for this terminal if not already done
  setupTerminalDataHandler(type);

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

// Focus initial terminal
terminals.claude.terminal.focus();

// Start connection to the current (claude) terminal
connect('claude');

// Mark browser tab as always connected (it's an iframe, not a WebSocket connection managed here)
updateTabConnectionState('browser', 'connected');

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  Object.values(terminals).forEach(instance => {
    if (instance.ws) {
      instance.ws.close();
    }
  });
});
