#!/bin/bash
set -euo pipefail

echo "Building HTTP proxy server for linux-arm64..."

cd "$(dirname "$0")"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "Error: bun is not installed. Please install it from https://bun.sh"
    exit 1
fi

# Build the proxy server binary
echo "Compiling http-proxy.ts to standalone binary..."
bun build --compile ./http-proxy.ts --target=bun-linux-arm64 --outfile=http-proxy

if [ -f "./http-proxy" ]; then
    echo "✓ Build successful! Binary created: ./http-proxy"
    ls -lh ./http-proxy
else
    echo "✗ Build failed!"
    exit 1
fi

echo ""
echo "To rebuild the Docker image with the new binary:"
echo "  docker build -t your-image-name ."

