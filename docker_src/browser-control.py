#!/usr/bin/env python3
"""
Simple HTTP server for controlling the embedded Chrome browser via xdotool
Listens on port 6090 for navigation commands
"""
import json
import subprocess
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ['DISPLAY'] = ':99'

class BrowserControlHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Log to stderr
        print(f"[browser-control] {format % args}", flush=True)
    
    def do_POST(self):
        if self.path == '/navigate':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body)
                url = data.get('url', '')
                
                if not url:
                    self.send_error(400, 'URL is required')
                    return
                
                print(f"[browser-control] Navigating to: {url}", flush=True)
                
                # Find Chrome window using xdotool
                try:
                    result = subprocess.run(
                        ['xdotool', 'search', '--class', 'chromium'],
                        capture_output=True,
                        text=True,
                        timeout=2
                    )
                    
                    if result.returncode != 0 or not result.stdout.strip():
                        print("[browser-control] Chrome window not found", flush=True)
                        self.send_response(500)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps({
                            'success': False,
                            'error': 'Chrome window not found'
                        }).encode())
                        return
                    
                    window_id = result.stdout.strip().split('\n')[0]
                    print(f"[browser-control] Found Chrome window: {window_id}", flush=True)
                    
                    # In kiosk mode, restart Chrome with the new URL
                    # Write the URL to a file for the restart loop to pick up
                    with open('/tmp/chrome-url.txt', 'w') as f:
                        f.write(url)
                    
                    print(f"[browser-control] Killing Chrome to navigate to: {url}", flush=True)
                    
                    # Kill Chrome - the restart loop will automatically restart it with the new URL
                    subprocess.run(['pkill', '-9', 'chrome'], timeout=2)
                    
                    print(f"[browser-control] Chrome restart initiated for: {url}", flush=True)
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'success': True,
                        'url': url
                    }).encode())
                    
                except subprocess.TimeoutExpired:
                    print("[browser-control] xdotool command timed out", flush=True)
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'success': False,
                        'error': 'Navigation timed out'
                    }).encode())
                    
            except Exception as e:
                print(f"[browser-control] Error: {e}", flush=True)
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': str(e)
                }).encode())
        else:
            self.send_error(404, 'Not Found')
    
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok'}).encode())
        else:
            self.send_error(404, 'Not Found')

if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 6090), BrowserControlHandler)
    print('[browser-control] Browser control server listening on port 6090', flush=True)
    server.serve_forever()

