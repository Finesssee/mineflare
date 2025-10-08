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
echo "=== Downloading hteetp binaries ==="
echo ""

REPO="eastlondoner/hteetp"

# Get latest version from GitHub API
echo "Getting latest hteetp version..."
VERSION=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
    echo "✗ Failed to get latest hteetp version!"
    exit 1
fi

echo "Latest hteetp version: $VERSION"

# Download linux-x64 binary
echo "Downloading hteetp-linux-x64..."
DOWNLOAD_URL_X64="https://github.com/$REPO/releases/download/$VERSION/hteetp-linux-x64.gz"
if curl -L -o hteetp-linux-x64.gz "$DOWNLOAD_URL_X64"; then
    echo "✓ Downloaded hteetp-linux-x64.gz"
    gunzip -f hteetp-linux-x64.gz
    chmod +x hteetp-linux-x64
    ls -lh ./hteetp-linux-x64
else
    echo "✗ Failed to download hteetp-linux-x64!"
    exit 1
fi

# Download linux-arm64 binary
echo "Downloading hteetp-linux-arm64..."
DOWNLOAD_URL_ARM64="https://github.com/$REPO/releases/download/$VERSION/hteetp-linux-arm64.gz"
if curl -L -o hteetp-linux-arm64.gz "$DOWNLOAD_URL_ARM64"; then
    echo "✓ Downloaded hteetp-linux-arm64.gz"
    gunzip -f hteetp-linux-arm64.gz
    chmod +x hteetp-linux-arm64
    ls -lh ./hteetp-linux-arm64
else
    echo "✗ Failed to download hteetp-linux-arm64!"
    exit 1
fi

echo ""
echo "=== Downloading ttyd binaries ==="
echo ""

TTYD_VERSION="1.7.7"
echo "Downloading ttyd version: $TTYD_VERSION"

# Download x64 binary
echo "Downloading ttyd-x64..."
TTYD_URL_X64="https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64"
if curl -fsSL -o ttyd-x64 "$TTYD_URL_X64"; then
    echo "✓ Downloaded ttyd-x64"
    chmod +x ttyd-x64
    ls -lh ./ttyd-x64
else
    echo "✗ Failed to download ttyd-x64!"
    exit 1
fi

# Download arm64 binary
echo "Downloading ttyd-arm64..."
TTYD_URL_ARM64="https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.aarch64"
if curl -fsSL -o ttyd-arm64 "$TTYD_URL_ARM64"; then
    echo "✓ Downloaded ttyd-arm64"
    chmod +x ttyd-arm64
    ls -lh ./ttyd-arm64
else
    echo "✗ Failed to download ttyd-arm64!"
    exit 1
fi

echo ""
echo "=== Downloading Claude Code binaries ==="
echo ""

GCS_BUCKET="https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases"

# Get the stable version number
echo "Getting stable Claude Code version..."
CLAUDE_VERSION=$(curl -fsSL "$GCS_BUCKET/stable")

if [ -z "$CLAUDE_VERSION" ]; then
    echo "✗ Failed to get Claude Code version!"
    exit 1
fi

echo "Claude Code version: $CLAUDE_VERSION"

# Download linux-x64 binary
echo "Downloading claude-linux-x64..."
CLAUDE_URL_X64="$GCS_BUCKET/$CLAUDE_VERSION/linux-x64/claude"
if curl -fsSL -o claude-x64 "$CLAUDE_URL_X64"; then
    echo "✓ Downloaded claude-x64"
    chmod +x claude-x64
    ls -lh ./claude-x64
else
    echo "✗ Failed to download claude-x64!"
    exit 1
fi

# Download linux-arm64 binary
echo "Downloading claude-linux-arm64..."
CLAUDE_URL_ARM64="$GCS_BUCKET/$CLAUDE_VERSION/linux-arm64/claude"
if curl -fsSL -o claude-arm64 "$CLAUDE_URL_ARM64"; then
    echo "✓ Downloaded claude-arm64"
    chmod +x claude-arm64
    ls -lh ./claude-arm64
else
    echo "✗ Failed to download claude-arm64!"
    exit 1
fi

echo ""
echo "All binaries built/downloaded successfully!"
echo "  - http-proxy-x64, http-proxy-arm64"
echo "  - file-server-x64, file-server-arm64"
echo "  - hteetp-linux-x64, hteetp-linux-arm64"
echo "  - ttyd-x64, ttyd-arm64"
echo "  - claude-x64, claude-arm64"
