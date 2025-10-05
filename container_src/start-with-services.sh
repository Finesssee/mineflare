#!/bin/bash
set -euo pipefail

do_optional_plugins() {
  # Temporarily disable exit-on-error for this function
  set +e
  
  if [ -n "${OPTIONAL_PLUGINS:-}" ]; then
    # Handle the case where OPTIONAL_PLUGINS is an empty string
    for plugin in $OPTIONAL_PLUGINS; do
      # Skip empty plugin names (can happen if OPTIONAL_PLUGINS is just "")
      if [ -z "$plugin" ]; then
        continue
      fi
      src="/data/optional_plugins/${plugin}.jar"
      dest="/data/plugins/${plugin}.jar"
      
      # Wrap operations in error handling
      if [ -f "$src" ]; then
        # Only create the symlink if it doesn't already exist or points elsewhere
        if [ ! -L "$dest" ] || [ "$(readlink "$dest")" != "$src" ]; then
          if ln -sf "$src" "$dest" 2>/dev/null; then
            echo "Optional plugin $plugin linked successfully"
          else
            echo "Warning: Failed to link optional plugin $plugin: $src -> $dest (continuing anyway)"
          fi
        else
          echo "Optional plugin $plugin already linked"
        fi
      else
        echo "Warning: Optional plugin $src not found, skipping."
      fi
    done
  fi
  
  # Re-enable exit-on-error
  set -e
}
start_tailscale() {

  if ! command -v tailscaled >/dev/null 2>&1; then
    return
  fi

  TAILSCALE_SOCKET="${TAILSCALE_SOCKET:-/run/tailscale/tailscaled.sock}"
  TAILSCALE_STATE_DIR="${TAILSCALE_STATE_DIR:-/var/lib/tailscale/tailscaled.state}"

  # Support both TAILSCALE_AUTHKEY and TS_AUTHKEY (from worker)
  AUTHKEY="${TS_AUTHKEY:-${TAILSCALE_AUTHKEY:-}}"
  
  # Skip Tailscale if no authkey is provided
  if [ -z "${AUTHKEY}" ]; then
    echo "Skipping Tailscale (no TS_AUTHKEY found)"
    return
  fi
  
  # Use TS_EXTRA_ARGS if available, fallback to TAILSCALE_ARGS
  EXTRA_ARGS="${TS_EXTRA_ARGS:-${TAILSCALE_ARGS:-}}"

  if ! pgrep -x tailscaled >/dev/null 2>&1; then
    # Add health check configuration if enabled
    TAILSCALED_ARGS="--state=${TAILSCALE_STATE_DIR} --socket=${TAILSCALE_SOCKET} --port=${TAILSCALE_PORT:-41641}"
    
    if [ "${TS_ENABLE_HEALTH_CHECK:-false}" = "true" ] && [ -n "${TS_LOCAL_ADDR_PORT:-}" ]; then
      TAILSCALED_ARGS="${TAILSCALED_ARGS} --debug=${TS_LOCAL_ADDR_PORT}"
    fi
    
    # Run in userspace mode for container compatibility
    TAILSCALED_ARGS="${TAILSCALED_ARGS} --tun=userspace-networking"
    
    sudo /usr/sbin/tailscaled ${TAILSCALED_ARGS} &
  fi

  if [ -n "${AUTHKEY}" ]; then
    # Wait for tailscaled to be ready before running tailscale up
    for i in $(seq 1 20); do
      if sudo tailscale --socket="${TAILSCALE_SOCKET}" status >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done

    echo "Connecting to Tailscale network..."
    sudo tailscale --socket="${TAILSCALE_SOCKET}" up \
      --authkey="${AUTHKEY}" \
      --accept-routes=false \
      --accept-dns=false \
      --netfilter-mode=off \
      ${TAILSCALE_HOSTNAME:+--hostname="${TAILSCALE_HOSTNAME}"} \
      ${EXTRA_ARGS}
    
    if [ $? -eq 0 ]; then
      echo "Tailscale connected successfully"
    else
      echo "Warning: Tailscale connection failed, continuing anyway..."
    fi
  fi
}

configure_dynmap() {
  if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${DYNMAP_BUCKET:-}" ]; then
    echo "Skipping Dynmap S3 configuration (no R2 credentials found)"
    return
  fi

  echo "Configuring Dynmap for S3 storage..."
  mkdir -p /data/plugins/dynmap

  # Copy the template configuration and substitute placeholders
  sed -e "s|{{AWS_ENDPOINT_URL}}|${AWS_ENDPOINT_URL}|g" \
      -e "s|{{DYNMAP_BUCKET}}|${DYNMAP_BUCKET}|g" \
      -e "s|{{AWS_ACCESS_KEY_ID}}|${AWS_ACCESS_KEY_ID}|g" \
      -e "s|{{AWS_SECRET_ACCESS_KEY}}|${AWS_SECRET_ACCESS_KEY}|g" \
      /dynmap-configuration.txt > /data/plugins/dynmap/configuration.txt

  echo "Dynmap S3 configuration complete"
  cat /data/plugins/dynmap/configuration.txt
}

configure_playit() {
  if [ -z "${PLAYIT_SECRET:-}" ]; then
    echo "Skipping playit.gg configuration (no PLAYIT_SECRET found)"
    return
  fi

  echo "Configuring playit.gg..."
  mkdir -p /data/plugins/playit-gg

  # Write the config.yml file
  cat > /data/plugins/playit-gg/config.yml << EOF
agent-secret: '${PLAYIT_SECRET}'
EOF

  echo "playit.gg configuration complete"
}

start_http_proxy() {
  echo "Starting HTTP proxy server..."
  
  if ! command -v /usr/local/bin/http-proxy >/dev/null 2>&1; then
    echo "Warning: HTTP proxy binary not found, skipping..."
    return
  fi
  
  # Run the HTTP proxy server in background
  (
    while true; do
      echo "Starting HTTP proxy (attempt at $(date))"
      /usr/local/bin/http-proxy || echo "HTTP proxy crashed, restarting in 2 seconds..."
      sleep 2
    done
  ) &
  
  echo "HTTP proxy server started in background"
}

start_file_server() {
  echo "Starting file server on port 8083..."
  
  # Create a simple Python HTTP server that serves files
  cat > /tmp/file_server.py << 'PYEOF'
import http.server
import socketserver
import os
import sys

class FileServerHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        # Remove leading slash and decode URL path
        path = self.path.lstrip('/')
        if not path:
            path = '/'
        
        # Use absolute path
        if not path.startswith('/'):
            path = '/' + path
        
        try:
            # Check if path exists
            if not os.path.exists(path):
                self.send_error(404, "File not found")
                return
            
            # Check if it's a directory
            if os.path.isdir(path):
                self.send_error(404, "Path is a directory")
                return
            
            # Try to read the file
            with open(path, 'rb') as f:
                content = f.read()
            
            # Send successful response
            self.send_response(200)
            self.send_header("Content-type", "application/octet-stream")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            
        except PermissionError:
            self.send_error(500, "Permission denied")
        except Exception as e:
            self.send_error(500, f"Internal server error: {str(e)}")
    
    def log_message(self, format, *args):
        # Log to stdout
        sys.stdout.write("[file-server] %s - - [%s] %s\n" %
                         (self.address_string(),
                          self.log_date_time_string(),
                          format%args))

PORT = 8083
Handler = FileServerHandler

with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"File server listening on port {PORT}")
    httpd.serve_forever()
PYEOF

  # Run the file server in a background loop for auto-restart
  (
    while true; do
      echo "Starting file server (attempt at $(date))"
      python3 /tmp/file_server.py || echo "File server crashed, restarting in 2 seconds..."
      sleep 2
    done
  ) &
  
  echo "File server started in background"
}

printenv

echo "Starting services..."

# Install optional plugins
do_optional_plugins || true

# Start Tailscale in background
# start_tailscale

# Configure Dynmap if R2 credentials are available
configure_dynmap

# Configure playit.gg if PLAYIT_SECRET is available
# configure_playit

# Start the HTTP proxy server
start_http_proxy

# Start the file server
start_file_server

echo "Services started, launching main application..."
echo "Command: $@"

# Execute the main command (Minecraft server) & pipe to hteetp
exec "$@" | hteetp --host 0.0.0.0 --port 8082 --size 1M --text
