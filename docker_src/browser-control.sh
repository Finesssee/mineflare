#!/bin/bash
# Simple HTTP server for controlling the embedded Chrome browser via xdotool
# Listens on port 6090

export DISPLAY=:99

while true; do
  # Listen for HTTP request using netcat
  REQUEST=$(echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ready\"}" | nc -l -p 6090 -q 1)
  
  # Extract URL from POST body (format: {"url":"https://example.com"})
  URL=$(echo "$REQUEST" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
  
  if [ -n "$URL" ]; then
    echo "Navigating to: $URL"
    
    # Find Chrome window
    WINDOW_ID=$(xdotool search --class "chromium" 2>/dev/null | head -1)
    
    if [ -z "$WINDOW_ID" ]; then
      echo "Chrome window not found" >&2
      continue
    fi
    
    # Focus Chrome window and navigate
    xdotool windowactivate --sync "$WINDOW_ID" 2>/dev/null
    sleep 0.1
    
    # Focus address bar
    xdotool key --clearmodifiers ctrl+l 2>/dev/null
    sleep 0.2
    
    # Type URL
    xdotool type --clearmodifiers "$URL" 2>/dev/null
    sleep 0.1
    
    # Press Enter
    xdotool key --clearmodifiers Return 2>/dev/null
    
    echo "Navigation command sent"
  fi
done

