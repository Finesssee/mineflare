#!/bin/bash
set -euo pipefail

echo "Building container services for multiple architectures..."

cd "$(dirname "$0")"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "Error: bun is not installed. Please install it from https://bun.sh"
    exit 1
fi

echo ""
echo "=== Building HTTP Proxy ==="
echo ""

# Build http-proxy for amd64 (x86_64)
echo "Compiling http-proxy.ts for linux-x64..."
bun build --compile ./http-proxy.ts --target=bun-linux-x64 --outfile=http-proxy-x64

if [ -f "./http-proxy-x64" ]; then
    echo "✓ Build successful! Binary created: ./http-proxy-x64"
    ls -lh ./http-proxy-x64
else
    echo "✗ x64 build failed!"
    exit 1
fi

# Build http-proxy for arm64
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
echo "=== Building File Server ==="
echo ""

# Build file-server for amd64 (x86_64)
echo "Compiling file-server.ts for linux-x64..."
bun build --compile ./file-server.ts --target=bun-linux-x64 --outfile=file-server-x64

if [ -f "./file-server-x64" ]; then
    echo "✓ Build successful! Binary created: ./file-server-x64"
    ls -lh ./file-server-x64
else
    echo "✗ x64 build failed!"
    exit 1
fi

# Build file-server for arm64
echo "Compiling file-server.ts for linux-arm64..."
bun build --compile ./file-server.ts --target=bun-linux-arm64 --outfile=file-server-arm64

if [ -f "./file-server-arm64" ]; then
    echo "✓ Build successful! Binary created: ./file-server-arm64"
    ls -lh ./file-server-arm64
else
    echo "✗ arm64 build failed!"
    exit 1
fi

echo ""
echo "=== Downloading hteetp install script ==="
echo ""

# Try to download hteetp install script from GitHub
if curl -fsSL https://raw.githubusercontent.com/eastlondoner/hteetp/main/install.sh -o hteetp-install.sh; then
    echo "✓ Downloaded hteetp install script from raw.githubusercontent.com"
elif curl -fsSL https://github.com/eastlondoner/hteetp/raw/main/install.sh -o hteetp-install.sh; then
    echo "✓ Downloaded hteetp install script from github.com"
else
    echo "✗ Failed to download hteetp install script!"
    exit 1
fi

chmod +x hteetp-install.sh
ls -lh ./hteetp-install.sh

echo ""
echo "All binaries built successfully!"
echo "  - http-proxy-x64, http-proxy-arm64"
echo "  - file-server-x64, file-server-arm64"
echo "  - hteetp-install.sh"
