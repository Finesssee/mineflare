#!/bin/bash
set -euo pipefail

echo "Building container services for multiple architectures..."

cd "$(dirname "$0")"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "Error: bun is not installed. Please install it from https://bun.sh"
    exit 1
fi

# Create a temporary directory for logs
LOG_DIR=$(mktemp -d)
trap "rm -rf $LOG_DIR" EXIT

# Function to build http-proxy binaries
build_http_proxy() {
    local log_file="$LOG_DIR/http-proxy.log"
    {
        echo "=== Building HTTP Proxy ==="
        
        echo "Compiling http-proxy.ts for linux-x64..."
        bun build --compile ./http-proxy.ts --target=bun-linux-x64 --outfile=http-proxy-x64
        
        if [ -f "./http-proxy-x64" ]; then
            echo "✓ Build successful! Binary created: ./http-proxy-x64"
            ls -lh ./http-proxy-x64
        else
            echo "✗ x64 build failed!"
            return 1
        fi
        
        echo "Compiling http-proxy.ts for linux-arm64..."
        bun build --compile ./http-proxy.ts --target=bun-linux-arm64 --outfile=http-proxy-arm64
        
        if [ -f "./http-proxy-arm64" ]; then
            echo "✓ Build successful! Binary created: ./http-proxy-arm64"
            ls -lh ./http-proxy-arm64
        else
            echo "✗ arm64 build failed!"
            return 1
        fi
        
        echo "✓ HTTP Proxy build completed successfully"
    } &> "$log_file"
    
    if [ $? -ne 0 ]; then
        cat "$log_file"
        return 1
    fi
    cat "$log_file"
    return 0
}

# Function to build file-server binaries
build_file_server() {
    local log_file="$LOG_DIR/file-server.log"
    {
        echo "=== Building File Server ==="
        
        echo "Compiling file-server.ts for linux-x64..."
        bun build --compile ./file-server.ts --target=bun-linux-x64 --outfile=file-server-x64
        
        if [ -f "./file-server-x64" ]; then
            echo "✓ Build successful! Binary created: ./file-server-x64"
            ls -lh ./file-server-x64
        else
            echo "✗ x64 build failed!"
            return 1
        fi
        
        echo "Compiling file-server.ts for linux-arm64..."
        bun build --compile ./file-server.ts --target=bun-linux-arm64 --outfile=file-server-arm64
        
        if [ -f "./file-server-arm64" ]; then
            echo "✓ Build successful! Binary created: ./file-server-arm64"
            ls -lh ./file-server-arm64
        else
            echo "✗ arm64 build failed!"
            return 1
        fi
        
        echo "✓ File Server build completed successfully"
    } &> "$log_file"
    
    if [ $? -ne 0 ]; then
        cat "$log_file"
        return 1
    fi
    cat "$log_file"
    return 0
}

# Function to download hteetp binaries
download_hteetp() {
    local log_file="$LOG_DIR/hteetp.log"
    {
        echo "=== Downloading hteetp binaries ==="
        
        REPO="eastlondoner/hteetp"
        
        echo "Getting latest hteetp version..."
        VERSION=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
        
        if [ -z "$VERSION" ]; then
            echo "✗ Failed to get latest hteetp version!"
            return 1
        fi
        
        echo "Latest hteetp version: $VERSION"
        
        echo "Downloading hteetp-linux-x64..."
        DOWNLOAD_URL_X64="https://github.com/$REPO/releases/download/$VERSION/hteetp-linux-x64.gz"
        if curl -L -o hteetp-linux-x64.gz "$DOWNLOAD_URL_X64"; then
            echo "✓ Downloaded hteetp-linux-x64.gz"
            gunzip -f hteetp-linux-x64.gz
            chmod +x hteetp-linux-x64
            ls -lh ./hteetp-linux-x64
        else
            echo "✗ Failed to download hteetp-linux-x64!"
            return 1
        fi
        
        echo "Downloading hteetp-linux-arm64..."
        DOWNLOAD_URL_ARM64="https://github.com/$REPO/releases/download/$VERSION/hteetp-linux-arm64.gz"
        if curl -L -o hteetp-linux-arm64.gz "$DOWNLOAD_URL_ARM64"; then
            echo "✓ Downloaded hteetp-linux-arm64.gz"
            gunzip -f hteetp-linux-arm64.gz
            chmod +x hteetp-linux-arm64
            ls -lh ./hteetp-linux-arm64
        else
            echo "✗ Failed to download hteetp-linux-arm64!"
            return 1
        fi
        
        echo "✓ hteetp download completed successfully"
    } &> "$log_file"
    
    if [ $? -ne 0 ]; then
        cat "$log_file"
        return 1
    fi
    cat "$log_file"
    return 0
}

# Function to download ttyd binaries
download_ttyd() {
    local log_file="$LOG_DIR/ttyd.log"
    {
        echo "=== Downloading ttyd binaries (shared-tty fork) ==="
        
        REPO="eastlondoner/ttyd"
        VERSION="1.8.0"
        
        echo "Getting ttyd version $VERSION from $REPO..."
        
        # Download SHA256SUMS for verification
        echo "Downloading SHA256SUMS..."
        SUMS_URL="https://github.com/$REPO/releases/download/$VERSION/SHA256SUMS"
        if curl -fsSL -o SHA256SUMS "$SUMS_URL"; then
            echo "✓ Downloaded SHA256SUMS"
        else
            echo "✗ Failed to download SHA256SUMS!"
            return 1
        fi
        
        # Download ttyd-x64 (x86_64)
        echo "Downloading ttyd.x86_64..."
        TTYD_URL_X64="https://github.com/$REPO/releases/download/$VERSION/ttyd.x86_64"
        if curl -fsSL -o ttyd-x64 "$TTYD_URL_X64"; then
            echo "✓ Downloaded ttyd-x64"
            
            # Verify checksum
            EXPECTED_CHECKSUM=$(grep "ttyd.x86_64" SHA256SUMS | cut -d' ' -f1)
            ACTUAL_CHECKSUM=$(sha256sum ttyd-x64 | cut -d' ' -f1)
            
            if [ "$ACTUAL_CHECKSUM" != "$EXPECTED_CHECKSUM" ]; then
                echo "✗ Checksum verification failed for ttyd-x64!"
                echo "  Expected: $EXPECTED_CHECKSUM"
                echo "  Actual: $ACTUAL_CHECKSUM"
                rm -f ttyd-x64
                return 1
            fi
            echo "✓ Checksum verified for ttyd-x64"
            
            chmod +x ttyd-x64
            ls -lh ./ttyd-x64
        else
            echo "✗ Failed to download ttyd-x64!"
            return 1
        fi
        
        # Download ttyd-arm64 (aarch64)
        echo "Downloading ttyd.aarch64..."
        TTYD_URL_ARM64="https://github.com/$REPO/releases/download/$VERSION/ttyd.aarch64"
        if curl -fsSL -o ttyd-arm64 "$TTYD_URL_ARM64"; then
            echo "✓ Downloaded ttyd-arm64"
            
            # Verify checksum
            EXPECTED_CHECKSUM=$(grep "ttyd.aarch64" SHA256SUMS | cut -d' ' -f1)
            ACTUAL_CHECKSUM=$(sha256sum ttyd-arm64 | cut -d' ' -f1)
            
            if [ "$ACTUAL_CHECKSUM" != "$EXPECTED_CHECKSUM" ]; then
                echo "✗ Checksum verification failed for ttyd-arm64!"
                echo "  Expected: $EXPECTED_CHECKSUM"
                echo "  Actual: $ACTUAL_CHECKSUM"
                rm -f ttyd-arm64
                return 1
            fi
            echo "✓ Checksum verified for ttyd-arm64"
            
            chmod +x ttyd-arm64
            ls -lh ./ttyd-arm64
        else
            echo "✗ Failed to download ttyd-arm64!"
            return 1
        fi
        
        # Clean up SHA256SUMS file
        rm -f SHA256SUMS
        
        echo "✓ ttyd (shared-tty fork) download completed successfully"
    } &> "$log_file"
    
    if [ $? -ne 0 ]; then
        cat "$log_file"
        return 1
    fi
    cat "$log_file"
    return 0
}

# Function to download Claude Code binaries
download_claude() {
    local log_file="$LOG_DIR/claude.log"
    {
        echo "=== Downloading Claude Code binaries ==="
        
        GCS_BUCKET="https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases"
        
        echo "Getting stable Claude Code version..."
        CLAUDE_VERSION=$(curl -fsSL "$GCS_BUCKET/stable")
        
        if [ -z "$CLAUDE_VERSION" ]; then
            echo "✗ Failed to get Claude Code version!"
            return 1
        fi
        
        echo "Claude Code version: $CLAUDE_VERSION"
        
        echo "Downloading manifest..."
        MANIFEST_JSON=$(curl -fsSL "$GCS_BUCKET/$CLAUDE_VERSION/manifest.json")
        
        if [ -z "$MANIFEST_JSON" ]; then
            echo "✗ Failed to download manifest!"
            return 1
        fi
        
        # Check if jq is available
        if ! command -v jq &> /dev/null; then
            echo "✗ jq is required but not installed!"
            return 1
        fi
        
        # Extract checksums for both platforms
        CHECKSUM_X64=$(echo "$MANIFEST_JSON" | jq -r '.platforms["linux-x64"].checksum // empty')
        CHECKSUM_ARM64=$(echo "$MANIFEST_JSON" | jq -r '.platforms["linux-arm64"].checksum // empty')
        
        if [ -z "$CHECKSUM_X64" ] || [[ ! "$CHECKSUM_X64" =~ ^[a-f0-9]{64}$ ]]; then
            echo "✗ Failed to get valid checksum for linux-x64!"
            return 1
        fi
        
        if [ -z "$CHECKSUM_ARM64" ] || [[ ! "$CHECKSUM_ARM64" =~ ^[a-f0-9]{64}$ ]]; then
            echo "✗ Failed to get valid checksum for linux-arm64!"
            return 1
        fi
        
        echo "linux-x64 checksum: $CHECKSUM_X64"
        echo "linux-arm64 checksum: $CHECKSUM_ARM64"
        
        # Download and verify claude-linux-x64
        echo "Downloading claude-linux-x64..."
        CLAUDE_URL_X64="$GCS_BUCKET/$CLAUDE_VERSION/linux-x64/claude"
        if curl -fsSL -o claude-x64 "$CLAUDE_URL_X64"; then
            echo "✓ Downloaded claude-x64"
            
            # Verify checksum
            ACTUAL_CHECKSUM=$(sha256sum claude-x64 | cut -d' ' -f1)
            if [ "$ACTUAL_CHECKSUM" != "$CHECKSUM_X64" ]; then
                echo "✗ Checksum verification failed for claude-x64!"
                echo "  Expected: $CHECKSUM_X64"
                echo "  Actual: $ACTUAL_CHECKSUM"
                rm -f claude-x64
                return 1
            fi
            echo "✓ Checksum verified for claude-x64"
            
            chmod +x claude-x64
            ls -lh ./claude-x64
        else
            echo "✗ Failed to download claude-x64!"
            return 1
        fi
        
        # Download and verify claude-linux-arm64
        echo "Downloading claude-linux-arm64..."
        CLAUDE_URL_ARM64="$GCS_BUCKET/$CLAUDE_VERSION/linux-arm64/claude"
        if curl -fsSL -o claude-arm64 "$CLAUDE_URL_ARM64"; then
            echo "✓ Downloaded claude-arm64"
            
            # Verify checksum
            ACTUAL_CHECKSUM=$(sha256sum claude-arm64 | cut -d' ' -f1)
            if [ "$ACTUAL_CHECKSUM" != "$CHECKSUM_ARM64" ]; then
                echo "✗ Checksum verification failed for claude-arm64!"
                echo "  Expected: $CHECKSUM_ARM64"
                echo "  Actual: $ACTUAL_CHECKSUM"
                rm -f claude-arm64
                return 1
            fi
            echo "✓ Checksum verified for claude-arm64"
            
            chmod +x claude-arm64
            ls -lh ./claude-arm64
        else
            echo "✗ Failed to download claude-arm64!"
            return 1
        fi
        
        echo "✓ Claude Code download completed successfully"
    } &> "$log_file"
    
    if [ $? -ne 0 ]; then
        cat "$log_file"
        return 1
    fi
    cat "$log_file"
    return 0
}

# Function to download Codex binaries
download_codex() {
    local log_file="$LOG_DIR/codex.log"
    {
        echo "=== Downloading Codex binaries ==="
        
        CODEX_VERSION="rust-v0.46.0"
        echo "Codex version: $CODEX_VERSION"
        
        echo "Downloading codex-linux-x64..."
        CODEX_URL_X64="https://github.com/openai/codex/releases/download/${CODEX_VERSION}/codex-x86_64-unknown-linux-gnu.tar.gz"
        if curl -fsSL -o codex-x64.tar.gz "$CODEX_URL_X64"; then
            echo "✓ Downloaded codex-x64.tar.gz"
            tar -xzf codex-x64.tar.gz -C .
            if [ -f "./codex-x86_64-unknown-linux-gnu" ]; then
                mv ./codex-x86_64-unknown-linux-gnu ./codex-x64
                chmod +x codex-x64
                ls -lh ./codex-x64
                rm -f codex-x64.tar.gz
            else
                echo "✗ Failed to extract codex-x64!"
                return 1
            fi
        else
            echo "✗ Failed to download codex-x64!"
            return 1
        fi
        
        echo "Downloading codex-linux-arm64..."
        CODEX_URL_ARM64="https://github.com/openai/codex/releases/download/${CODEX_VERSION}/codex-aarch64-unknown-linux-gnu.tar.gz"
        if curl -fsSL -o codex-arm64.tar.gz "$CODEX_URL_ARM64"; then
            echo "✓ Downloaded codex-arm64.tar.gz"
            tar -xzf codex-arm64.tar.gz -C .
            if [ -f "./codex-aarch64-unknown-linux-gnu" ]; then
                mv ./codex-aarch64-unknown-linux-gnu ./codex-arm64
                chmod +x codex-arm64
                ls -lh ./codex-arm64
                rm -f codex-arm64.tar.gz
            else
                echo "✗ Failed to extract codex-arm64!"
                return 1
            fi
        else
            echo "✗ Failed to download codex-arm64!"
            return 1
        fi
        
        echo "✓ Codex download completed successfully"
    } &> "$log_file"
    
    if [ $? -ne 0 ]; then
        cat "$log_file"
        return 1
    fi
    cat "$log_file"
    return 0
}

# Function to build Gemini CLI binaries
build_gemini() {
    local log_file="$LOG_DIR/gemini.log"
    {
        echo "=== Building Gemini CLI ==="
        
        GEMINI_VERSION="v0.9.0"
        echo "Gemini CLI version: $GEMINI_VERSION"
        
        echo "Downloading gemini.js..."
        GEMINI_URL="https://github.com/google-gemini/gemini-cli/releases/download/${GEMINI_VERSION}/gemini.js"
        if curl -fsSL -o gemini.js "$GEMINI_URL"; then
            echo "✓ Downloaded gemini.js"
            ls -lh ./gemini.js
        else
            echo "✗ Failed to download gemini.js!"
            return 1
        fi
        
        echo "Compiling gemini.js for linux-x64..."
        bun build --compile ./gemini.js --target=bun-linux-x64 --outfile=gemini-x64
        
        if [ -f "./gemini-x64" ]; then
            echo "✓ Build successful! Binary created: ./gemini-x64"
            ls -lh ./gemini-x64
        else
            echo "✗ x64 build failed!"
            return 1
        fi
        
        echo "Compiling gemini.js for linux-arm64..."
        bun build --compile ./gemini.js --target=bun-linux-arm64 --outfile=gemini-arm64
        
        if [ -f "./gemini-arm64" ]; then
            echo "✓ Build successful! Binary created: ./gemini-arm64"
            ls -lh ./gemini-arm64
        else
            echo "✗ arm64 build failed!"
            return 1
        fi
        
        # Clean up source file
        rm -f gemini.js
        
        echo "✓ Gemini CLI build completed successfully"
    } &> "$log_file"
    
    if [ $? -ne 0 ]; then
        cat "$log_file"
        return 1
    fi
    cat "$log_file"
    return 0
}

echo ""
echo "Starting parallel builds and downloads..."
echo ""

# Run all tasks in parallel
build_http_proxy &
PID_HTTP_PROXY=$!

build_file_server &
PID_FILE_SERVER=$!

download_hteetp &
PID_HTEETP=$!

download_ttyd &
PID_TTYD=$!

download_claude &
PID_CLAUDE=$!

download_codex &
PID_CODEX=$!

build_gemini &
PID_GEMINI=$!

# Wait for all tasks and collect exit codes (bash 3.2 compatible)
PIDS=($PID_HTTP_PROXY $PID_FILE_SERVER $PID_HTEETP $PID_TTYD $PID_CLAUDE $PID_CODEX $PID_GEMINI)
TASK_NAMES=("HTTP Proxy build" "File Server build" "hteetp download" "ttyd download" "Claude Code download" "Codex download" "Gemini CLI build")
TASK_STATUS=()

# Wait for each task and collect status
for pid in "${PIDS[@]}"; do
    wait $pid
    TASK_STATUS+=($?)
done

# Check if any tasks failed
FAILED_TASKS=()
for i in $(seq 0 $((${#PIDS[@]} - 1))); do
    if [ "${TASK_STATUS[$i]}" -ne 0 ]; then
        FAILED_TASKS+=("${TASK_NAMES[$i]}")
    fi
done

echo ""
if [ ${#FAILED_TASKS[@]} -eq 0 ]; then
    echo "✓ All binaries built/downloaded successfully!"
    echo "  - http-proxy-x64, http-proxy-arm64"
    echo "  - file-server-x64, file-server-arm64"
    echo "  - hteetp-linux-x64, hteetp-linux-arm64"
    echo "  - ttyd-x64, ttyd-arm64"
    echo "  - claude-x64, claude-arm64"
    echo "  - codex-x64, codex-arm64"
    echo "  - gemini-x64, gemini-arm64"
    exit 0
else
    echo "✗ The following tasks failed:"
    for task in "${FAILED_TASKS[@]}"; do
        echo "  - $task"
    done
    exit 1
fi
