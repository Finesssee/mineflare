#!/bin/bash
set -euo pipefail

start_tailscale() {
  if ! command -v tailscaled >/dev/null 2>&1; then
    return
  fi

  mkdir -p /run/tailscale

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
    
    /usr/sbin/tailscaled ${TAILSCALED_ARGS} &
  fi

  if [ -n "${AUTHKEY}" ]; then
    # Wait for tailscaled to be ready before running tailscale up
    for i in $(seq 1 20); do
      if tailscale --socket="${TAILSCALE_SOCKET}" status >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done

    echo "Connecting to Tailscale network..."
    tailscale --socket="${TAILSCALE_SOCKET}" up \
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

echo "Starting services..."

# Start Tailscale in background
start_tailscale

echo "Services started, launching main application..."
echo "Command: $@"

# Execute the main command (Minecraft server)
exec "$@"

