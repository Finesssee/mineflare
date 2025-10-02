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

echo "Starting services..."

# Install optional plugins
do_optional_plugins || true

# Start Tailscale in background
start_tailscale

# Configure Dynmap if R2 credentials are available
configure_dynmap

echo "Services started, launching main application..."
echo "Command: $@"

# Execute the main command (Minecraft server)
exec "$@"

