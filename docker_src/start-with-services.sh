#!/bin/bash
set -euo pipefail

# ============================================================================
# Mineflare Container Service Manager
# ============================================================================
# This script manages all services running in the Mineflare container.
#
# PORT ALLOCATION:
# === Minecraft Server ===
# 8080  - Health checks
# 25565  - Minecraft game traffic
# 25575 - RCON console
#
# === Internal Services ===
# 8082  - Log tail (hteetp HTTP server)
# 8083  - File server + backup API
# 8084  - HTTP proxy control channel
# 8085-8100 - HTTP proxy data channels (16 channels for R2)
#
# === AI Terminals (ttyd) ===
# 7681  - Claude terminal
# 7682  - Codex terminal
# 7683  - Gemini terminal
# 7684  - Bash terminal
#
# === Embedded Browser (noVNC/Chrome) ===
# 5900  - x11vnc (VNC server)
# 6080  - websockify (VNC-to-WebSocket proxy)
# 6090  - Browser control API (xdotool navigation)
# ============================================================================

# Source SDKMAN if available (for Gradle and other dev tools)
export SDKMAN_DIR="/usr/local/sdkman"
if [[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]]; then
  set +u  # Temporarily disable unbound variable check
  source "$SDKMAN_DIR/bin/sdkman-init.sh"
  set -u
fi

# Source Java environment
if [[ -f /etc/profile.d/java21.sh ]]; then
  source /etc/profile.d/java21.sh
fi

# Create status directory and set permissions
sudo mkdir -p /status
sudo chown 1000:1000 /status
sudo chmod 755 /status

# Create logs directory and set permissions
sudo mkdir -p /logs
sudo chown 1000:1000 /logs
sudo chmod 755 /logs

# Helper function to write startup status
write_status() {
  echo "$1" | sudo tee /status/step.txt > /dev/null
  sudo chown 1000:1000 /status/step.txt
  sudo chmod 644 /status/step.txt
  echo "[Status] $1"
}

ensure_version_specific_plugins() {
  echo "Ensuring version-specific plugins are correctly linked..."
  
  # Get current Minecraft version from environment
  CURRENT_VERSION="${VERSION:-1.21.10}"
  echo "Current Minecraft version: $CURRENT_VERSION"
  
  # Define version-specific plugins and their patterns
  # These plugins are stored in /opt/minecraft/plugins/ and symlinked to /data/plugins/
  declare -A VERSION_PLUGINS=(
    ["dynmap"]="Dynmap-3.7-beta-11-spigot-${CURRENT_VERSION}.jar"
  )
  
  for plugin in "${!VERSION_PLUGINS[@]}"; do
    version_file="/opt/minecraft/plugins/${VERSION_PLUGINS[$plugin]}"
    plugin_link="/data/plugins/${plugin}.jar"
    
    if [ -f "$version_file" ]; then
      # Check if the symlink exists and points to the correct file
      if [ ! -L "$plugin_link" ] || [ "$(readlink "$plugin_link")" != "$version_file" ]; then
        # Remove existing file/symlink/directory if it exists
        if [ -e "$plugin_link" ] || [ -L "$plugin_link" ]; then
          echo "Removing existing plugin file/symlink: $plugin_link"
          rm -rf "$plugin_link"
        fi
        
        echo "Linking ${plugin} to version-specific file: $version_file"
        ln -sf "$version_file" "$plugin_link"
      else
        echo "${plugin} already correctly linked to $version_file"
      fi
    else
      echo "Warning: Version-specific file not found: $version_file"
    fi
  done
  
  echo "Version-specific plugin linking completed"
}

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
  if [ "${AUTHKEY}" = "null" ]; then
    echo "Skipping Tailscale (TS_AUTHKEY is null)"
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
    
    sudo /usr/sbin/tailscaled ${TAILSCALED_ARGS} >> /logs/tailscale.log 2>&1 &
    echo "Tailscaled started, logging to /logs/tailscale.log"
  fi

  if [ -n "${AUTHKEY}" ]; then
    # Wait for tailscaled to be ready before running tailscale up
    for i in $(seq 1 20); do
      if sudo tailscale --socket="${TAILSCALE_SOCKET}" status >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done

    echo "AUTHKEY: ${AUTHKEY}"
    echo "Connecting to Tailscale network..."
    sudo tailscale --socket="${TAILSCALE_SOCKET}" up \
      --authkey="${AUTHKEY}" \
      --accept-routes=false \
      --accept-dns=false \
      --netfilter-mode=off \
      ${TAILSCALE_HOSTNAME:+--hostname="${TAILSCALE_HOSTNAME}"} \
      ${EXTRA_ARGS} >> /logs/tailscale.log 2>&1
    
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


start_http_proxy() {
  # PORTS: 8084 (control), 8085-8100 (data channels - 16 channels)
  # Provides S3-compatible HTTP interface to R2 buckets
  echo "Starting HTTP proxy server..."
  local PROXY_BINARY="/usr/local/bin/http-proxy"
  local CONTROL_PORT=8084
  local DATA_PORT_START=8085
  local DATA_PORT_END=8100
  
  if [ ! -x "$PROXY_BINARY" ]; then
    echo "Warning: HTTP proxy binary not found or not executable, skipping..."
    return
  fi
  
  echo "Using proxy binary: $PROXY_BINARY"
  echo "HTTP proxy will use control port $CONTROL_PORT and data ports $DATA_PORT_START-$DATA_PORT_END"
  
  # Run the HTTP proxy server in background
  (
    while true; do
      echo "Starting HTTP proxy on ports $CONTROL_PORT, $DATA_PORT_START-$DATA_PORT_END (attempt at $(date))"
      "$PROXY_BINARY" || echo "HTTP proxy crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/http-proxy.log 2>&1 &
  HTTP_PROXY_PID=$!
  
  echo "HTTP proxy server started in background (PID: $HTTP_PROXY_PID), logging to /logs/http-proxy.log"
}

setup_hteetp() {
  echo "Setting up hteetp binary..."
  local HTEETP_BINARY="/usr/local/bin/hteetp"

  if [ ! -x "$HTEETP_BINARY" ]; then
    echo "Error: hteetp binary not found or not executable!"
    return 1
  fi
  
  echo "hteetp binary is ready at $HTEETP_BINARY"
  return 0
}

setup_codex() {
  echo "Setting up codex binary..."
  local CODEX_BINARY="/usr/local/bin/codex"

  if [ ! -x "$CODEX_BINARY" ]; then
    echo "Error: codex binary not found or not executable!"
    return 1
  fi
  
  echo "codex binary is ready at $CODEX_BINARY"
  return 0
}

setup_gemini() {
  echo "Setting up gemini binary..."
  local GEMINI_BINARY="/usr/local/bin/gemini"

  if [ ! -x "$GEMINI_BINARY" ]; then
    echo "Error: gemini binary not found or not executable!"
    return 1
  fi

  echo "gemini binary is ready at $GEMINI_BINARY"
  return 0
}

start_file_server() {
  # PORT: 8083 (File server + backup/restore API)
  local FILE_SERVER_PORT=8083
  echo "Starting file server on port $FILE_SERVER_PORT..."
  local FILE_SERVER_BINARY="/usr/local/bin/file-server"

  if [ ! -x "$FILE_SERVER_BINARY" ]; then
    echo "Warning: File server binary not found or not executable, skipping..."
    return
  fi

  echo "Using file server binary: $FILE_SERVER_BINARY"
  echo "File server will listen on port $FILE_SERVER_PORT"

  # Run the file server in background with auto-restart
  (
    while true; do
      echo "Starting file server on port $FILE_SERVER_PORT (attempt at $(date))"
      "$FILE_SERVER_BINARY" || echo "File server crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/file-server.log 2>&1 &
  FILE_SERVER_PID=$!

  echo "File server started in background (PID: $FILE_SERVER_PID) on port $FILE_SERVER_PORT, logging to /logs/file-server.log"
}

start_xvfb() {
  # PORT: N/A (Display :99, not a network port)
  echo "Starting Xvfb (virtual display)..."
  
  (
    while true; do
      echo "Starting Xvfb on display :99 (attempt at $(date))"
      /usr/bin/Xvfb :99 -screen 0 1280x720x24 || echo "Xvfb crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/xvfb.log 2>&1 &
  XVFB_PID=$!
  
  echo "Xvfb started in background (PID: $XVFB_PID), logging to /logs/xvfb.log"
  
  # Wait for Xvfb to be ready
  for i in $(seq 1 20); do
    if xdpyinfo -display :99 >/dev/null 2>&1; then
      echo "Xvfb is ready"
      break
    fi
    sleep 0.5
  done
}

# Removed Fluxbox - running Chrome in kiosk mode without window manager for cleaner display

start_x11vnc() {
  # PORT: 5900 (VNC server)
  local VNC_PORT=5900
  echo "Starting x11vnc (VNC server) on port $VNC_PORT..."
  
  (
    while true; do
      echo "Starting x11vnc on port $VNC_PORT (attempt at $(date))"
      DISPLAY=:99 /usr/bin/x11vnc -forever -shared -rfbport "$VNC_PORT" -nopw || echo "x11vnc crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/x11vnc.log 2>&1 &
  X11VNC_PID=$!
  
  echo "x11vnc started in background (PID: $X11VNC_PID) on port $VNC_PORT, logging to /logs/x11vnc.log"
  
  # Wait for x11vnc to be ready
  for i in $(seq 1 20); do
    if netstat -ln | grep -q ":$VNC_PORT "; then
      echo "x11vnc is ready on port $VNC_PORT"
      break
    fi
    sleep 0.5
  done
}

start_novnc() {
  # PORT: 6080 (WebSocket proxy to VNC)
  local WEBSOCKET_PORT=6080
  local VNC_TARGET_PORT=5900
  echo "Starting websockify (VNC-to-WebSocket proxy) on port $WEBSOCKET_PORT..."
  
  (
    while true; do
      echo "Starting websockify on port $WEBSOCKET_PORT -> localhost:$VNC_TARGET_PORT (attempt at $(date))"
      # Start websockify to proxy VNC (localhost:5900) to WebSocket (port 6080)
      # WebSocket connections will come through the worker at /src/browser/ws
      bash /opt/websockify/run "$WEBSOCKET_PORT" "localhost:$VNC_TARGET_PORT" || echo "websockify crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/websockify.log 2>&1 &
  NOVNC_PID=$!
  
  echo "websockify started in background (PID: $NOVNC_PID) on port $WEBSOCKET_PORT, logging to /logs/websockify.log"
  echo "Browser WebSocket proxy: localhost:$WEBSOCKET_PORT -> localhost:$VNC_TARGET_PORT"
}

start_browser_control() {
  # PORT: 6090 (Browser control HTTP API - xdotool navigation)
  local BROWSER_CONTROL_PORT=6090
  echo "Starting browser control server on port $BROWSER_CONTROL_PORT..."
  
  (
    while true; do
      echo "Starting browser control server on port $BROWSER_CONTROL_PORT (attempt at $(date))"
      /usr/bin/python3 /usr/local/bin/browser-control.py || echo "Browser control crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/browser-control.log 2>&1 &
  BROWSER_CONTROL_PID=$!
  
  echo "Browser control server started in background (PID: $BROWSER_CONTROL_PID) on port $BROWSER_CONTROL_PORT, logging to /logs/browser-control.log"
  echo "Browser navigation API: POST localhost:$BROWSER_CONTROL_PORT/navigate"
}

start_chrome() {
  echo "Starting Chrome browser in kiosk mode (fullscreen, no decorations)..."
  local CHROME_BINARY="/opt/chrome/chrome"
  
  if [ ! -x "$CHROME_BINARY" ]; then
    echo "Warning: Chrome binary not found or not executable, skipping..."
    return
  fi
  
  echo "Using Chrome binary: $CHROME_BINARY"
  
  # Create chrome profile directory
  mkdir -p /tmp/chrome-profile
  sudo chown -R 1000:1000 /tmp/chrome-profile
  
  # Set LD_LIBRARY_PATH to include Chrome's bundled libraries
  export LD_LIBRARY_PATH="/opt/chrome:${LD_LIBRARY_PATH:-}"
  
  (
    while true; do
      # Check if there's a URL file for navigation
      if [ -f /tmp/chrome-url.txt ]; then
        TARGET_URL=$(cat /tmp/chrome-url.txt)
        echo "Starting Chrome in kiosk mode with URL: $TARGET_URL (attempt at $(date))"
      else
        TARGET_URL="https://chatgpt.com"
        echo "Starting Chrome in kiosk mode (attempt at $(date))"
      fi
      
      DISPLAY=:99 LD_LIBRARY_PATH="/opt/chrome:${LD_LIBRARY_PATH:-}" "$CHROME_BINARY" \
        --kiosk \
        --no-sandbox \
        --disable-dev-shm-usage \
        --disable-gpu \
        --disable-infobars \
        --disable-session-crashed-bubble \
        --user-data-dir=/tmp/chrome-profile \
        --window-size=1280,720 \
        --window-position=0,0 \
        "$TARGET_URL" || echo "Chrome crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/chrome.log 2>&1 &
  CHROME_PID=$!

  echo "Chrome started in background (PID: $CHROME_PID), logging to /logs/chrome.log"
}

start_ttyd() {
  # PORTS: 7681 (Claude), 7682 (Codex), 7683 (Gemini), 7684 (Bash)
  echo "Starting web terminals (ttyd) for Claude, Codex, Gemini, and Bash..."
  local TTYD_BINARY="/usr/local/bin/ttyd"
  local CLAUDE_PORT=7681
  local CODEX_PORT=7682
  local GEMINI_PORT=7683
  local BASH_PORT=7684

  if [ ! -x "$TTYD_BINARY" ]; then
    echo "Warning: No compatible ttyd binary found or not executable, skipping..."
    return
  fi

  echo "Using ttyd binary: $TTYD_BINARY"

  # Common ttyd client options
  TTYD_THEME='{"background":"#0a1612","foreground":"#e0e0e0","cursor":"#55FF55","cursorAccent":"#0a1612","selectionBackground":"#57A64E"}'

  # Run ttyd for Claude (port 7681) with shared PTY mode
  (
    export CLAUDE_HOME="/data/.local/claude"
    while true; do
      echo "Starting ttyd for Claude on port $CLAUDE_PORT with shared PTY mode (attempt at $(date))"
      "$TTYD_BINARY" \
        --port "$CLAUDE_PORT" \
        --interface 0.0.0.0 \
        --base-path /src/terminal/claude \
        -Q \
        --session-width 160 \
        --session-height 80 \
        --writable \
        --client-option fontSize=14 \
        --client-option "theme=$TTYD_THEME" \
        claude --continue || echo "ttyd (Claude) crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/ttyd-claude.log 2>&1 &
  TTYD_CLAUDE_PID=$!
  echo "ttyd (Claude) started on port 7681 with shared PTY mode (PID: $TTYD_CLAUDE_PID)"

  # Run ttyd for Codex (port 7682) with shared PTY mode
  (
    export CODEX_HOME="/data/.local/codex"
    while true; do
      echo "Starting ttyd for Codex on port $CODEX_PORT with shared PTY mode (attempt at $(date))"
      "$TTYD_BINARY" \
        --port "$CODEX_PORT" \
        --interface 0.0.0.0 \
        --base-path /src/terminal/codex \
        -Q \
        --session-width 160 \
        --session-height 80 \
        --writable \
        --client-option fontSize=14 \
        --client-option "theme=$TTYD_THEME" \
        codex || echo "ttyd (Codex) crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/ttyd-codex.log 2>&1 &
  TTYD_CODEX_PID=$!
  echo "ttyd (Codex) started on port $CODEX_PORT with shared PTY mode (PID: $TTYD_CODEX_PID)"

  # Run ttyd for Gemini (port 7683) with shared PTY mode
  (
    export GEMINI_SUPPRESS_HOME_WARNING=1
    while true; do
      echo "Starting ttyd for Gemini on port $GEMINI_PORT with shared PTY mode (attempt at $(date))"
      "$TTYD_BINARY" \
        --port "$GEMINI_PORT" \
        --interface 0.0.0.0 \
        --base-path /src/terminal/gemini \
        -Q \
        --session-width 160 \
        --session-height 80 \
        --writable \
        --client-option fontSize=14 \
        --client-option "theme=$TTYD_THEME" \
        gemini --prompt-interactive 'hi' || echo "ttyd (Gemini) crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/ttyd-gemini.log 2>&1 &
  TTYD_GEMINI_PID=$!
  echo "ttyd (Gemini) started on port $GEMINI_PORT with shared PTY mode (PID: $TTYD_GEMINI_PID)"

  # Run ttyd for Bash (port 7684) with shared PTY mode
  (
    while true; do
      echo "Starting ttyd for Bash on port $BASH_PORT with shared PTY mode (attempt at $(date))"
      "$TTYD_BINARY" \
        --port "$BASH_PORT" \
        --interface 0.0.0.0 \
        --base-path /src/terminal/bash \
        -Q \
        --session-width 160 \
        --session-height 80 \
        --writable \
        --client-option fontSize=14 \
        --client-option "theme=$TTYD_THEME" \
        bash || echo "ttyd (Bash) crashed (exit code: $?), restarting in 2 seconds..."
      sleep 2
    done
  ) >> /logs/ttyd-bash.log 2>&1 &
  TTYD_BASH_PID=$!
  echo "ttyd (Bash) started on port $BASH_PORT with shared PTY mode (PID: $TTYD_BASH_PID)"

  echo "All ttyd terminals started successfully on ports $CLAUDE_PORT, $CODEX_PORT, $GEMINI_PORT, $BASH_PORT"
}

backup_on_shutdown() {
  echo "Performing backup before shutdown..."
  
  # Backup each world directory and plugins via file server
  local dir='/data'
  echo "Backing up $dir..."
    
  # Use curl to trigger backup via file server on port 8083
  if curl -s -f "http://localhost:8083${dir}?backup=true" > /tmp/backup_result.json 2>&1; then
    echo "✓ Backup completed for $dir"
    cat /tmp/backup_result.json
  else
    echo "✗ Warning: Backup failed for $dir (continuing anyway)"
    cat /tmp/backup_result.json 2>&1 || true
  fi
  
  echo "Backup process completed"
}

kill_background_processes() {
  echo "Killing background processes..."

  # Kill Minecraft process and its children
  if [ -n "${MINECRAFT_PID:-}" ]; then
    echo "Killing Minecraft server (PID: $MINECRAFT_PID) and its children..."
    # Kill the entire process group
    pkill -KILL -P "$MINECRAFT_PID" 2>/dev/null || true
    kill -KILL "$MINECRAFT_PID" 2>/dev/null || true
  fi

  # Kill file server process and its children
  if [ -n "${FILE_SERVER_PID:-}" ]; then
    echo "Killing file server (PID: $FILE_SERVER_PID) and its children..."
    # Kill the entire process group
    pkill -KILL -P "$FILE_SERVER_PID" 2>/dev/null || true
    kill -KILL "$FILE_SERVER_PID" 2>/dev/null || true
  fi

  # Kill ttyd processes and their children
  if [ -n "${TTYD_CLAUDE_PID:-}" ]; then
    echo "Killing ttyd Claude (PID: $TTYD_CLAUDE_PID) and its children..."
    pkill -KILL -P "$TTYD_CLAUDE_PID" 2>/dev/null || true
    kill -KILL "$TTYD_CLAUDE_PID" 2>/dev/null || true
  fi
  
  if [ -n "${TTYD_CODEX_PID:-}" ]; then
    echo "Killing ttyd Codex (PID: $TTYD_CODEX_PID) and its children..."
    pkill -KILL -P "$TTYD_CODEX_PID" 2>/dev/null || true
    kill -KILL "$TTYD_CODEX_PID" 2>/dev/null || true
  fi
  
  if [ -n "${TTYD_GEMINI_PID:-}" ]; then
    echo "Killing ttyd Gemini (PID: $TTYD_GEMINI_PID) and its children..."
    pkill -KILL -P "$TTYD_GEMINI_PID" 2>/dev/null || true
    kill -KILL "$TTYD_GEMINI_PID" 2>/dev/null || true
  fi

  # Kill HTTP proxy process and its children
  if [ -n "${HTTP_PROXY_PID:-}" ]; then
    echo "Killing HTTP proxy (PID: $HTTP_PROXY_PID) and its children..."
    # Kill the entire process group
    pkill -KILL -P "$HTTP_PROXY_PID" 2>/dev/null || true
    kill -KILL "$HTTP_PROXY_PID" 2>/dev/null || true
  fi

  # Kill VNC/Browser processes and their children
  if [ -n "${CHROME_PID:-}" ]; then
    echo "Killing Chrome (PID: $CHROME_PID) and its children..."
    pkill -KILL -P "$CHROME_PID" 2>/dev/null || true
    kill -KILL "$CHROME_PID" 2>/dev/null || true
  fi
  
  if [ -n "${BROWSER_CONTROL_PID:-}" ]; then
    echo "Killing browser control (PID: $BROWSER_CONTROL_PID) and its children..."
    pkill -KILL -P "$BROWSER_CONTROL_PID" 2>/dev/null || true
    kill -KILL "$BROWSER_CONTROL_PID" 2>/dev/null || true
  fi
  
  if [ -n "${NOVNC_PID:-}" ]; then
    echo "Killing websockify (PID: $NOVNC_PID) and its children..."
    pkill -KILL -P "$NOVNC_PID" 2>/dev/null || true
    kill -KILL "$NOVNC_PID" 2>/dev/null || true
  fi
  
  if [ -n "${X11VNC_PID:-}" ]; then
    echo "Killing x11vnc (PID: $X11VNC_PID) and its children..."
    pkill -KILL -P "$X11VNC_PID" 2>/dev/null || true
    kill -KILL "$X11VNC_PID" 2>/dev/null || true
  fi
  
  if [ -n "${XVFB_PID:-}" ]; then
    echo "Killing Xvfb (PID: $XVFB_PID) and its children..."
    pkill -KILL -P "$XVFB_PID" 2>/dev/null || true
    kill -KILL "$XVFB_PID" 2>/dev/null || true
  fi

  echo "Background processes terminated"
}

handle_shutdown() {
  echo "Received SIGTERM, initiating graceful shutdown..."
  
  # Forward SIGTERM to the main process (Minecraft server)
  if [ -n "${MAIN_PID:-}" ]; then
    echo "Sending SIGTERM to main process (PID: $MAIN_PID)..."
    kill -TERM "$MAIN_PID" 2>/dev/null || true
    
    # Wait for main process to exit gracefully (with timeout)
    echo "Waiting for main process to exit gracefully..."
    for i in $(seq 1 60); do
      if ! kill -0 "$MAIN_PID" 2>/dev/null; then
        echo "Main process exited gracefully"
        break
      fi
      sleep 1
    done
    
    # Force kill if still running after timeout
    if kill -0 "$MAIN_PID" 2>/dev/null; then
      echo "Main process did not exit in time, forcing shutdown..."
      kill -KILL "$MAIN_PID" 2>/dev/null || true
    fi
  fi
  
  # Run backup after main process has stopped
  backup_on_shutdown
  
  # Kill all background processes
  kill_background_processes
  
  # Exit
  echo "Shutdown complete"
  exit 0
}

setup_server_symlinks() {
  echo "Setting up server jar symlinks..."
  
  # Get current Minecraft version from environment
  CURRENT_VERSION="${VERSION:-1.21.10}"
  echo "Current Minecraft version: $CURRENT_VERSION"
  
  # Define server jar patterns to symlink
  SERVER_JAR_PATTERNS=(
    "paper-*.jar"
    "spigot-*.jar"
    "bukkit-*.jar"
    "minecraft_server*.jar"
    "server.jar"
  )
  
  # Also symlink the .env files that mc-image-helper creates
  ENV_FILE_PATTERNS=(
    ".paper-*.env"
    ".spigot-*.env"
    ".bukkit-*.env"
  )
  
  symlink_count=0
  
  # Create symlinks for server jar files
  for pattern in "${SERVER_JAR_PATTERNS[@]}"; do
    for jar_file in /opt/minecraft/server/${pattern}; do
      if [ -f "$jar_file" ]; then
        filename=$(basename "$jar_file")
        target_file="/data/${filename}"
        
        # Remove existing file/symlink/directory if it exists
        if [ -e "$target_file" ] || [ -L "$target_file" ]; then
          echo "Removing existing file/symlink: $target_file"
          rm -rf "$target_file"
        fi
        
        # Create symlink
        ln -sf "$jar_file" "$target_file"
        echo "Created server jar symlink: $target_file -> $jar_file"
        symlink_count=$((symlink_count + 1))
      fi
    done
  done
  
  # Create symlinks for environment files
  for pattern in "${ENV_FILE_PATTERNS[@]}"; do
    for env_file in /opt/minecraft/server/${pattern}; do
      if [ -f "$env_file" ]; then
        filename=$(basename "$env_file")
        target_file="/data/${filename}"
        
        # Remove existing file/symlink/directory if it exists
        if [ -e "$target_file" ] || [ -L "$target_file" ]; then
          echo "Removing existing file/symlink: $target_file"
          rm -rf "$target_file"
        fi
        
        # Create symlink
        ln -sf "$env_file" "$target_file"
        echo "Created env file symlink: $target_file -> $env_file"
        symlink_count=$((symlink_count + 1))
      fi
    done
  done
  
  if [ $symlink_count -eq 0 ]; then
    echo "No server jar files found to symlink"
  else
    echo "Server jar symlinks created ($symlink_count symlinks)"
  fi
}

restore_from_backup() {
  echo "Checking for available backups to restore..."
  write_status "Checking for backups"
  
  # Check if we have AWS credentials configured
  if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_ENDPOINT_URL:-}" ] || [ -z "${DATA_BUCKET_NAME:-${DYNMAP_BUCKET:-}}" ]; then
    echo "No R2 credentials found, skipping restore"
    return
  fi
  
  BUCKET="${DATA_BUCKET_NAME:-${DYNMAP_BUCKET:-}}"
  
  # Wait for file server to be ready (max 30 seconds)
  echo "Waiting for file server to be ready..."
  write_status "Waiting for file server"
  for i in $(seq 1 60); do
    # Check if file server responds (even with 404, it means it's running)
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:8083/" 2>/dev/null | grep -q "^[0-9]\{3\}$"; then
      echo "File server is ready"
      break
    fi
    if [ $i -eq 60 ]; then
      echo "Warning: File server did not become ready, skipping restore"
      return 1
    fi
    sleep 0.5
  done
  
  # Wait for HTTP proxy control connection to be established (max 30 seconds)
  echo "Waiting for HTTP proxy control connection..."
  write_status "Waiting for HTTP proxy connection"
  for i in $(seq 1 60); do
    PROXY_STATUS=$(curl -s "http://localhost:3128/healthcheck" 2>/dev/null || echo "")
    if [ "$PROXY_STATUS" = "CONNECTED" ]; then
      echo "HTTP proxy control connection is CONNECTED"
      break
    fi
    if [ $i -eq 60 ]; then
      echo "Warning: HTTP proxy control connection not established, skipping restore"
      return 1
    fi
    if [ -n "$PROXY_STATUS" ]; then
      echo "HTTP proxy status: $PROXY_STATUS (waiting for CONNECTED...)"
    fi
    sleep 0.5
  done
  
  # Restore the entire /data directory
  dir_name="data"
  
  # Check if directory already exists and has content (e.g., level.dat indicates a world exists)
  if [ -d "/$dir_name" ] && [ -f "/$dir_name/level.dat" ]; then
    echo "Directory /$dir_name already exists with world data (level.dat found), skipping restore"
    return
  fi
  
  echo "Looking for backups for $dir_name..."
  
  # List backups for this directory from R2
  # Note: S3 list returns keys in lexicographic (alphabetical) ascending order
  # Our backup naming uses reverse-epoch seconds as prefix, so ascending order = newest first
  # Format: backups/<reverseEpochSec>_<YYYYMMDDHH>_<dir>.tar.gz
  LIST_URL="${AWS_ENDPOINT_URL}/${BUCKET}/?prefix=backups/&delimiter="
  
  if ! BACKUP_LIST=$(curl -s -f "$LIST_URL" 2>&1); then
    echo "Warning: Failed to list backups for $dir_name, skipping restore"
    return 1
  fi
  
  # Extract backup keys that end with _<dir_name>.tar.gz
  # S3 returns them in ascending lex order, which means newest-first due to reverse-epoch prefix
  # Just take the first match (newest)
  LATEST_BACKUP=$(echo "$BACKUP_LIST" | grep -o '<Key>backups/[^<]*_'"${dir_name}"'\.tar\.gz</Key>' | sed 's/<Key>//g' | sed 's|</Key>||g' | head -n 1)
  
  if [ -z "$LATEST_BACKUP" ]; then
    echo "No backups found for $dir_name, skipping restore"
    return
  fi
  
  echo "Found latest backup: $LATEST_BACKUP"
  echo "Restoring $dir_name from $LATEST_BACKUP..."
  write_status "Restoring world data from backup"
  
  # Call the file server restore endpoint
  RESTORE_URL="http://localhost:8083/${dir_name}?restore=${LATEST_BACKUP}"
  
  if curl -s -f "$RESTORE_URL" > /tmp/restore_result.json 2>&1; then
    echo "✓ Restore completed for $dir_name"
    cat /tmp/restore_result.json
  else
    echo "✗ Warning: Restore failed for $dir_name"
    cat /tmp/restore_result.json 2>&1 || true
  fi
  
  echo "Restore process completed"
}




write_status "Initializing services"

echo "Starting services..."


# Start VNC services for embedded browser
write_status "Starting virtual display (Xvfb)" 
start_xvfb &

write_status "Starting VNC server (x11vnc)"
start_x11vnc &

write_status "Starting web VNC client (noVNC)"
start_novnc &

write_status "Starting Chrome browser in kiosk mode"
start_chrome &

write_status "Starting browser control server"
start_browser_control &

# Start the file server
write_status "Starting file server"
start_file_server

# Start the HTTP proxy server
write_status "Starting HTTP proxy"
start_http_proxy

# Start Tailscale in background if it's enabled
start_tailscale &

# Setup hteetp binary
write_status "Setting up hteetp"
setup_hteetp

# Setup codex binary
write_status "Setting up codex"
setup_codex

# Setup gemini binary
write_status "Setting up gemini"
setup_gemini

# Restore from backups before starting Minecraft server
write_status "Checking for backups to restore"
write_status "Fixing /data permissions"
# Ensure /data is owned by minecraft user and writable before restore
sudo chown -R 1000:1000 /data || true
sudo chmod -R u+rwX /data || true
restore_from_backup || (sleep 15 && restore_from_backup)

# Set up server jar symlinks after restore (in case restore overwrote them)
write_status "Setting up server jar symlinks"
setup_server_symlinks || true


# Start the web terminal (ttyd) after the backups are restored
write_status "Starting web terminal"
start_ttyd

# Ensure version-specific plugins are correctly linked
write_status "Ensuring version-specific plugins"
ensure_version_specific_plugins || true

# Install optional plugins
write_status "Installing optional plugins"
do_optional_plugins || true

# Configure Dynmap if R2 credentials are available
write_status "Configuring Dynmap"
configure_dynmap

echo "Services started, launching main application..."
echo "Command: $@"

write_status "Starting Minecraft server"

# Set up SIGTERM trap
trap handle_shutdown SIGTERM

# Execute Minecraft in restart loop (background)
(
  while true; do
    echo "Starting Minecraft server (attempt at $(date))"
    write_status "Minecraft server running"
    "$@" | hteetp --host 0.0.0.0 --port 8082 --size 1M --text
    EXIT_CODE=$?
    echo "Minecraft server exited (code: $EXIT_CODE), restarting in 2 seconds..."
    write_status "Minecraft server restarting"
    sleep 2
  done
) &
MINECRAFT_PID=$!

echo "Minecraft server started in restart loop (PID: $MINECRAFT_PID)"

# Wait indefinitely for container shutdown signal
wait
