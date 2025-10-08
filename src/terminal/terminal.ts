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

// Initialize terminal
const term = new Terminal({
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
});

// Add fit addon for terminal resizing
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// Add web links addon
const webLinksAddon = new WebLinksAddon();
term.loadAddon(webLinksAddon);

// Open terminal in DOM
term.open(document.getElementById('terminal')!);
fitAddon.fit();

// Connection status management
const statusEl = document.getElementById('connection-status');
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
const textEncoder = new TextEncoder();

function showStatus(message: string, type: string) {
    statusEl!.textContent = message;
    statusEl!.className = type;
    statusEl!.style.display = 'block';

    if (type === 'connected') {
        setTimeout(() => {
            statusEl!.style.display = 'none';
        }, 3000);
    }
}

async function connect() {
    // Clear any existing reconnect timeout
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    showStatus('Connecting...', 'connecting');

    try {
        // Fetch WebSocket token
        const tokenResponse = await fetchApi('/auth/ws-token', {
            credentials: 'include',
        });
        if (!tokenResponse.ok) {
            console.error('Failed to get WebSocket token, status:', tokenResponse.status);
            showStatus('Authentication failed', 'error');
            return;
        }

        const { token } = await tokenResponse.json() as { token: string };

        // Determine WebSocket protocol (ws or wss)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const backend = new URL(backendUrl('/src/terminal/ws'));
        backend.protocol = protocol;
        
        // Add token as query parameter
        backend.searchParams.set('token', token);
        const wsUrl = backend.toString();

        console.log('Connecting to:', wsUrl);

        // ttyd uses the "tty" subprotocol
        ws = new WebSocket(wsUrl, ['tty']);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
            console.log('WebSocket connected');
            showStatus('Connected', 'connected');
            reconnectAttempts = 0;

            // Send initial resize using ttyd protocol: binary "1" + JSON
            const resizeJson = JSON.stringify({
                AuthToken: '',
                columns: term.cols,
                rows: term.rows
            });
            ws?.send(textEncoder.encode(resizeJson));
        };

        ws.onmessage = (event) => {
            // Handle ttyd protocol messages
            if (event.data instanceof ArrayBuffer) {
                const data = new Uint8Array(event.data);
                if (data.length === 0) return;

                // First byte is the command type
                const cmd = String.fromCharCode(data[0]);
                
                if (cmd === '0') {
                    // OUTPUT: Write the rest of the data to terminal
                    if (data.length > 1) {
                        term.write(data.subarray(1));
                    }
                } else if (cmd === '1') {
                    // SET_WINDOW_TITLE
                    const title = new TextDecoder().decode(data.subarray(1));
                    document.title = title;
                } else if (cmd === '2') {
                    // SET_PREFERENCES - could be handled if needed
                    console.log('Received preferences');
                }
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            showStatus('Connection error', 'error');
        };

        ws.onclose = (event) => {
            console.log('WebSocket closed:', event.code, event.reason);

            if (reconnectAttempts < maxReconnectAttempts) {
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                reconnectAttempts++;
                showStatus(`Reconnecting... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`, 'connecting');

                reconnectTimeout = setTimeout(() => {
                    connect();
                }, delay);
            } else {
                showStatus('Connection lost. Refresh to reconnect.', 'error');
                term.write('\r\n\x1b[1;31mConnection lost. Please refresh the page to reconnect.\x1b[0m\r\n');
            }
        };
    } catch (error) {
        console.error('Failed to establish connection:', error);
        showStatus('Failed to connect', 'error');
        
        // Retry connection if we haven't exceeded max attempts
        if (reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            reconnectAttempts++;
            reconnectTimeout = setTimeout(() => {
                connect();
            }, delay);
        }
    }
}

// Handle terminal input
term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Send input using ttyd protocol: binary with first byte '0' (INPUT)
        // Encode the data as UTF-8
        const encoded = textEncoder.encode(data);
        const message = new Uint8Array(encoded.length + 1);
        message[0] = '0'.charCodeAt(0); // INPUT command
        message.set(encoded, 1);
        ws.send(message);
    }
});

// Handle terminal resize
let resizeTimeout: NodeJS.Timeout | number | null = null;
function handleResize() {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        fitAddon.fit();

        if (ws && ws.readyState === WebSocket.OPEN) {
            // Send resize using ttyd protocol: binary "1" + JSON
            const resizeJson = JSON.stringify({
                AuthToken: '',
                columns: term.cols,
                rows: term.rows
            });
            ws.send(textEncoder.encode(resizeJson));
        }
    }, 100);
}

window.addEventListener('resize', handleResize);

// Handle focus
term.focus();

// Start connection
connect();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
});