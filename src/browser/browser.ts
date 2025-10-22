// Import utilities from the main app
import { fetchApi, backendUrl } from '../client/utils/api.ts';

const status = document.getElementById('status')!;
const screen = document.getElementById('screen')!;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const goBtn = document.getElementById('go-btn')!;
const backBtn = document.getElementById('back-btn')!;
const forwardBtn = document.getElementById('forward-btn')!;
const refreshBtn = document.getElementById('refresh-btn')!;
let rfb: any;

function updateStatus(text: string, hide = false) {
    if (hide) {
        status.classList.add('hidden');
    } else {
        status.querySelector('div:last-child')!.textContent = text;
    }
}

// Dynamically load noVNC RFB module from CDN
async function loadNoVNC() {
    // Use noVNC from a CDN for simplicity
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
        import RFB from 'https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js';
        window.RFB = RFB;
    `;
    document.head.appendChild(script);
    
    // Wait for RFB to be available
    let attempts = 0;
    while (!(window as any).RFB && attempts < 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    if (!(window as any).RFB) {
        throw new Error('Failed to load noVNC library');
    }
    
    return (window as any).RFB;
}

// Handle clipboard - sync between browser and VNC
function setupClipboard(rfbInstance: any) {
    // Send local clipboard to VNC when it changes
    window.addEventListener('paste', async (e) => {
        e.preventDefault();
        try {
            const text = await navigator.clipboard.readText();
            console.log('Sending clipboard to VNC:', text.substring(0, 50) + '...');
            rfbInstance.clipboardPasteFrom(text);
        } catch (err) {
            console.warn('Failed to read clipboard:', err);
        }
    });

    // Receive clipboard from VNC
    rfbInstance.addEventListener('clipboard', (e: any) => {
        console.log('Received clipboard from VNC:', e.detail.text.substring(0, 50) + '...');
        // Copy to local clipboard
        navigator.clipboard.writeText(e.detail.text).catch(err => {
            console.warn('Failed to write to clipboard:', err);
        });
    });

    // Also handle Ctrl+V to paste
    document.addEventListener('keydown', async (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            e.preventDefault();
            try {
                const text = await navigator.clipboard.readText();
                console.log('Ctrl+V: Sending clipboard to VNC');
                rfbInstance.clipboardPasteFrom(text);
            } catch (err) {
                console.warn('Failed to paste:', err);
            }
        }
    });
}

// Auto-connect to VNC server through authenticated WebSocket
async function connect() {
    try {
        updateStatus('Getting authentication token...');
        
        // Get WebSocket token from auth endpoint
        const tokenResponse = await fetchApi('/auth/ws-token');
        const { token } = await tokenResponse.json() as { token: string };
        
        if (!token) {
            throw new Error('Failed to get WebSocket token');
        }
        
        updateStatus('Loading noVNC...');
        
        // Load noVNC library
        const RFB = await loadNoVNC();
        
        updateStatus('Connecting to browser...');
        
        // Construct WebSocket URL through the worker's /src/browser/ws endpoint
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = backendUrl(`/src/browser/ws?token=${token}`);
        wsUrl.protocol = protocol;
        const wsUrlString = wsUrl.toString();
        console.log('Connecting to VNC server at:', wsUrlString);
        
        // Create RFB instance
        // Note: Don't specify wsProtocols - websockify doesn't use subprotocols like ttyd does
        rfb = new (window as any).RFB(screen, wsUrlString, {
            credentials: { password: '' },
            shared: true,
            repeaterID: ''
        });

        // Hide cursor locally (we'll see the remote cursor from Chrome)
        rfb.showDotCursor = false;
        
        // Scale to fit screen
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        
        // Enable clipboard
        rfb.clipViewport = false;
        rfb.dragViewport = false;
        
        // Event handlers
        rfb.addEventListener('connect', () => {
            console.log('Connected to VNC server');
            updateStatus('', true);
            setupClipboard(rfb);
        });

        rfb.addEventListener('disconnect', (e: any) => {
            console.log('Disconnected from VNC server:', e.detail);
            updateStatus('Disconnected. Reconnecting...', false);
            status.classList.remove('hidden');
            
            // Auto-reconnect after 2 seconds
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        });

        rfb.addEventListener('credentialsrequired', () => {
            console.log('Credentials required (unexpected)');
            updateStatus('Authentication required', false);
        });

        rfb.addEventListener('securityfailure', (e: any) => {
            console.error('Security failure:', e.detail);
            updateStatus('Security failure: ' + e.detail.reason, false);
        });

    } catch (err: any) {
        console.error('Failed to connect:', err);
        updateStatus('Failed to connect: ' + err.message, false);
        
        // Reload page if authentication failed (token might be invalid)
        if (err.message.includes('401') || err.message.includes('auth')) {
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
        }
    }
}

// Navigate to a URL using the browser control API
async function navigateToUrl(url: string) {
    if (!url) return;
    
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    
    try {
        console.log('Navigating to:', url);
        const response = await fetchApi('/api/browser/navigate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        
        const result = await response.json() as { success: boolean; error?: string };
        if (!result.success) {
            console.error('Navigation failed:', result.error);
            alert('Navigation failed: ' + result.error);
        } else {
            console.log('Navigation successful');
            urlInput.value = url;
        }
    } catch (err) {
        console.error('Failed to navigate:', err);
        alert('Failed to navigate: ' + err);
    }
}

// Send keyboard shortcuts to the browser
function sendKeys(keys: string) {
    // xdotool key simulation - keys like 'alt+Left', 'alt+Right', 'F5'
    // We'll use the navigate API with special commands
    // For now, we'll just send Ctrl+R for refresh
    console.log('Sending keys:', keys);
    // This would need browser control API extension to support keyboard shortcuts
}

// Set up navigation controls
goBtn.addEventListener('click', () => {
    navigateToUrl(urlInput.value);
});

urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        navigateToUrl(urlInput.value);
    }
});

// Browser navigation buttons (these will need xdotool key commands via browser control)
backBtn.addEventListener('click', () => {
    // Send Alt+Left for back in Chrome
    console.log('Back button - sending Alt+Left');
    // For now, we'll use the noVNC keyboard API to simulate this
    if (rfb) {
        // Alt+Left
        rfb.sendKey(0xFFE9, 'Alt', true); // Alt down
        rfb.sendKey(0xFF51, 'Left', true); // Left down
        rfb.sendKey(0xFF51, 'Left', false); // Left up
        rfb.sendKey(0xFFE9, 'Alt', false); // Alt up
    }
});

forwardBtn.addEventListener('click', () => {
    // Send Alt+Right for forward in Chrome
    console.log('Forward button - sending Alt+Right');
    if (rfb) {
        rfb.sendKey(0xFFE9, 'Alt', true);
        rfb.sendKey(0xFF53, 'Right', true);
        rfb.sendKey(0xFF53, 'Right', false);
        rfb.sendKey(0xFFE9, 'Alt', false);
    }
});

refreshBtn.addEventListener('click', () => {
    // Send F5 for refresh
    console.log('Refresh button - sending F5');
    if (rfb) {
        rfb.sendKey(0xFFC2, 'F5', true);
        rfb.sendKey(0xFFC2, 'F5', false);
    }
});

// Check for URL parameter to auto-navigate
function checkAutoNavigate() {
    const params = new URLSearchParams(window.location.search);
    const autoUrl = params.get('url');
    if (autoUrl) {
        console.log('Auto-navigating to:', autoUrl);
        urlInput.value = autoUrl;
        // Wait a bit for connection to establish before navigating
        setTimeout(() => {
            navigateToUrl(autoUrl);
        }, 2000);
    }
}

// Start connection when page loads
connect();
checkAutoNavigate();

