#!/bin/bash
set -euo pipefail

echo "Building HTTP proxy server for multiple architectures..."

cd "$(dirname "$0")"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "Error: bun is not installed. Please install it from https://bun.sh"
    exit 1
fi

# Build for amd64 (x86_64) - most common in cloud environments
echo "Compiling http-proxy.ts for linux-x64..."
bun build --compile ./http-proxy.ts --target=bun-linux-x64 --outfile=http-proxy-x64

if [ -f "./http-proxy-x64" ]; then
    echo "✓ Build successful! Binary created: ./http-proxy-x64"
    ls -lh ./http-proxy-x64
else
    echo "✗ x64 build failed!"
    exit 1
fi

# Build for arm64 - for ARM-based systems
echo "Compiling http-proxy.ts for linux-arm64..."
bun build --compile ./http-proxy.ts --target=bun-linux-arm64 --outfile=http-proxy-arm64

if [ -f "./http-proxy-arm64" ]; then
    echo "✓ Build successful! Binary created: ./http-proxy-arm64"
    ls -lh ./http-proxy-arm64
else
    echo "✗ arm64 build failed!"
    exit 1
fi

echo ""
echo "Both binaries built successfully!"
echo "To rebuild the Docker image with the new binaries:"
echo "  docker build -t your-image-name ."

