import { backendUrl, fetchApi } from '../client/utils/api';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

/**
 * ttyd WebSocket Protocol:
 * 
 * Connection: Use subprotocol ['tty'], binary type 'arraybuffer'
 * 
 * All messages are sent as binary (Uint8Array/ArrayBuffer).
 * 
 * Client -> Server:
 *   - INPUT ('0'): Binary with first byte '0', followed by UTF-8 encoded input data
 *   - RESIZE_TERMINAL ('1'): Binary UTF-8 encoding of '1' + JSON.stringify({columns, rows})
 *   - PAUSE ('2'): Binary UTF-8 encoding of '2'
 *   - RESUME ('3'): Binary UTF-8 encoding of '3'
 * 
 * Server -> Client:
 *   - OUTPUT ('0'): Binary with first byte '0', followed by terminal output data
 *   - SET_WINDOW_TITLE ('1'): Binary with first byte '1', followed by UTF-8 title
 *   - SET_PREFERENCES ('2'): Binary with first byte '2', followed by preferences JSON
 */

type TerminalType = 'claude' | 'codex' | 'gemini';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  ws: WebSocket | null;
  reconnectAttempts: number;
  reconnectTimeout: NodeJS.Timeout | null;
  connected: boolean;
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
let currentTerminal: TerminalType = 'claude';

function createTerminalInstance(type: TerminalType): TerminalInstance {
  const terminal = new Terminal(terminalConfig);
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  
  const webLinksAddon = new WebLinksAddon();
  terminal.loadAddon(webLinksAddon);
  
  const element = document.getElementById(`terminal-${type}`)!;
  terminal.open(element);
  fitAddon.fit();
  
  return {
    terminal,
    fitAddon,
    ws: null,
    reconnectAttempts: 0,
    reconnectTimeout: null,
    connected: false
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
  
  // Clear any existing reconnect timeout
  if (instance.reconnectTimeout) {
    clearTimeout(instance.reconnectTimeout);
    instance.reconnectTimeout = null;
  }

  // If already connected, don't reconnect
  if (instance.connected && instance.ws?.readyState === WebSocket.OPEN) {
    return;
  }

  if (type === currentTerminal) {
    showStatus(`Connecting to ${type}...`, 'connecting');
  }

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
      console.log(`${type} WebSocket connected`);
      instance.connected = true;
      instance.reconnectAttempts = 0;
      
      if (type === currentTerminal) {
        showStatus(`Connected to ${type}`, 'connected');
      }

      // Send initial resize using ttyd protocol: binary "1" + JSON
      const resizeJson = JSON.stringify({
        AuthToken: '',
        columns: instance.terminal.cols,
        rows: instance.terminal.rows
      });
      instance.ws?.send(textEncoder.encode(resizeJson));
    };

    instance.ws.onmessage = (event) => {
      // Handle ttyd protocol messages
      if (event.data instanceof ArrayBuffer) {
        const data = new Uint8Array(event.data);
        if (data.length === 0) return;

        // First byte is the command type
        const cmd = String.fromCharCode(data[0]);
        
        if (cmd === '0') {
          // OUTPUT: Write the rest of the data to terminal
          if (data.length > 1) {
            instance.terminal.write(data.subarray(1));
          }
        } else if (cmd === '1') {
          // SET_WINDOW_TITLE
          const title = new TextDecoder().decode(data.subarray(1));
          if (type === currentTerminal) {
            document.title = title;
          }
        } else if (cmd === '2') {
          // SET_PREFERENCES - could be handled if needed
          console.log(`${type} received preferences`);
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

      if (instance.reconnectAttempts < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, instance.reconnectAttempts), 30000);
        instance.reconnectAttempts++;
        
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
    if (type === currentTerminal) {
      showStatus('Failed to connect', 'error');
    }
    
    // Retry connection if we haven't exceeded max attempts
    if (instance.reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, instance.reconnectAttempts), 30000);
      instance.reconnectAttempts++;
      instance.reconnectTimeout = setTimeout(() => {
        connect(type);
      }, delay);
    }
  }
}

// Handle terminal input for all terminals
Object.entries(terminals).forEach(([type, instance]) => {
  instance.terminal.onData((data) => {
    if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
      // Send input using ttyd protocol: binary with first byte '0' (INPUT)
      const encoded = textEncoder.encode(data);
      const message = new Uint8Array(encoded.length + 1);
      message[0] = '0'.charCodeAt(0); // INPUT command
      message.set(encoded, 1);
      instance.ws.send(message);
    }
  });
});

// Handle terminal resize
let resizeTimeout: NodeJS.Timeout | number | null = null;
function handleResize() {
  if (resizeTimeout) clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    Object.entries(terminals).forEach(([_, instance]) => {
      instance.fitAddon.fit();

      if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
        // Send resize using ttyd protocol: binary "1" + JSON
        const resizeJson = JSON.stringify({
          AuthToken: '',
          columns: instance.terminal.cols,
          rows: instance.terminal.rows
        });
        instance.ws.send(textEncoder.encode(resizeJson));
      }
    });
  }, 100);
}

window.addEventListener('resize', handleResize);

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
  
  // Focus the new terminal
  terminals[type].terminal.focus();
  
  // Fit the terminal
  setTimeout(() => {
    terminals[type].fitAddon.fit();
  }, 100);
  
  // Connect if not already connected
  if (!terminals[type].connected) {
    connect(type);
  }
  
  // Update status if there's a connection issue
  if (terminals[type].ws?.readyState !== WebSocket.OPEN) {
    showStatus(`Connecting to ${type}...`, 'connecting');
  }
}

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
