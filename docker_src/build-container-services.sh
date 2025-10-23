#!/bin/bash
set -euo pipefail

echo "Building container services for multiple architectures..."

cd "$(dirname "$0")"

declare -a GITHUB_AUTH_HEADER=()

# Detect offline mode
OFFLINE_FLAG="${MINEFLARE_OFFLINE_MODE:-${MINEFLARE_OFFLINE:-false}}"
OFFLINE_FLAG=$(printf '%s' "$OFFLINE_FLAG" | tr '[:upper:]' '[:lower:]')

if [[ "$OFFLINE_FLAG" != "true" ]]; then
    if command -v gh &>/dev/null; then
        if gh auth status &>/dev/null; then
            GH_TOKEN=$(gh auth token 2>/dev/null | tr -d '\r\n')
            if [[ -n "$GH_TOKEN" ]]; then
                echo "Using GitHub token from gh CLI"
                GITHUB_AUTH_HEADER=(-H "Authorization: Bearer $GH_TOKEN")
            fi
        fi
    fi

    if [[ ${#GITHUB_AUTH_HEADER[@]} -eq 0 && -n "${GITHUB_TOKEN:-}" ]]; then
        echo "Using GitHub token from GITHUB_TOKEN environment variable"
        GITHUB_AUTH_HEADER=(-H "Authorization: Bearer $GITHUB_TOKEN")
    fi
fi

if [[ "$OFFLINE_FLAG" == "true" ]]; then
    echo "Offline mode detected; verifying cached container service binaries..."

    REQUIRED_FILES=(
        "http-proxy-x64"
        "http-proxy-arm64"
        "file-server-x64"
        "file-server-arm64"
        "hteetp-linux-x64"
        "hteetp-linux-arm64"
        "ttyd-x64"
        "ttyd-arm64"
        "claude-x64"
        "claude-arm64"
        "codex-x64"
        "codex-arm64"
        "gemini-x64"
        "gemini-arm64"
        "chrome-x64.tar.gz"
        "chrome-arm64.tar.gz"
        "mineflare-x64"
        "mineflare-arm64"
    )

    MISSING_FILES=()
    for file in "${REQUIRED_FILES[@]}"; do
        if [[ ! -f "$file" ]]; then
            MISSING_FILES+=("$file")
        fi
    done

    if [[ ${#MISSING_FILES[@]} -eq 0 ]]; then
        echo "✓ All required container service binaries already present; skipping downloads."
        exit 0
    fi

    echo "✗ Missing the following required binaries for offline build:"
    for file in "${MISSING_FILES[@]}"; do
        echo "  - $file"
    done
    echo "Please run a full build with network access once to cache these artifacts."
    exit 1
fi

# Ensure required tooling for online mode
MISSING_TOOLS=()
if [[ "$OFFLINE_FLAG" != "true" ]]; then
    if ! command -v bun &>/dev/null; then
        MISSING_TOOLS+=("bun")
    fi
    if ! command -v jq &>/dev/null; then
        MISSING_TOOLS+=("jq")
    fi
    if ! command -v curl &>/dev/null; then
        MISSING_TOOLS+=("curl")
    fi
    if ! command -v unzip &>/dev/null; then
        MISSING_TOOLS+=("unzip")
    fi

    if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
        echo "Error: missing required tools: ${MISSING_TOOLS[*]}"
        exit 1
    fi
fi

# Create a temporary directory for logs
LOG_DIR=$(mktemp -d)
MAIN_PID=$$
trap '[ "$$" = "'$MAIN_PID'" ] && rm -rf "'$LOG_DIR'"' EXIT

# Portable SHA256 helper (supports macOS without sha256sum)
sha256_file() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

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
    } &>"$log_file"

    local exit_status=$?
    if [[ -f "$log_file" ]]; then
        cat "$log_file"
    fi
    return $exit_status
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
    } &>"$log_file"

    local exit_status=$?
    if [[ -f "$log_file" ]]; then
        cat "$log_file"
    fi
    return $exit_status
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
        if curl -L "${GITHUB_AUTH_HEADER[@]}" -o hteetp-linux-x64.gz "$DOWNLOAD_URL_X64"; then
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
        if curl -L "${GITHUB_AUTH_HEADER[@]}" -o hteetp-linux-arm64.gz "$DOWNLOAD_URL_ARM64"; then
            echo "✓ Downloaded hteetp-linux-arm64.gz"
            gunzip -f hteetp-linux-arm64.gz
            chmod +x hteetp-linux-arm64
            ls -lh ./hteetp-linux-arm64
        else
            echo "✗ Failed to download hteetp-linux-arm64!"
            return 1
        fi

        echo "✓ hteetp download completed successfully"
    } &>"$log_file"

    local exit_status=$?
    if [[ -f "$log_file" ]]; then
        cat "$log_file"
    fi
    return $exit_status
}

# Function to download ttyd binaries
download_ttyd() {
    local log_file="$LOG_DIR/ttyd.log"
    {
        echo "=== Downloading ttyd binaries ==="

        REPO="eastlondoner/ttyd"

        echo "Getting latest ttyd version..."
        VERSION=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

        if [ -z "$VERSION" ]; then
            echo "✗ Failed to get latest ttyd version!"
            return 1
        fi

        echo "Latest ttyd version: $VERSION"

        # Download SHA256SUMS for verification
        echo "Downloading SHA256SUMS..."
        SUMS_URL="https://github.com/$REPO/releases/download/$VERSION/SHA256SUMS"
        if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o SHA256SUMS "$SUMS_URL"; then
            echo "✓ Downloaded SHA256SUMS"
        else
            echo "✗ Failed to download SHA256SUMS!"
            return 1
        fi

        # Check/download ttyd-x64 (x86_64)
        TTYD_URL_X64="https://github.com/$REPO/releases/download/$VERSION/ttyd.x86_64"
        EXPECTED_CHECKSUM_X64=$(grep "ttyd.x86_64" SHA256SUMS | cut -d' ' -f1)

        if [[ -f ttyd-x64 ]]; then
            ACTUAL_CHECKSUM=$(sha256_file ttyd-x64)
            if [[ "$ACTUAL_CHECKSUM" == "$EXPECTED_CHECKSUM_X64" ]]; then
                echo "✓ ttyd-x64 already cached with matching checksum, skipping download"
            else
                echo "Local ttyd-x64 checksum mismatch, re-downloading..."
                rm -f ttyd-x64
            fi
        fi

        if [[ ! -f ttyd-x64 ]]; then
            echo "Downloading ttyd.x86_64..."
            if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o ttyd-x64 "$TTYD_URL_X64"; then
                echo "✓ Downloaded ttyd-x64"

                # Verify checksum
                ACTUAL_CHECKSUM=$(sha256_file ttyd-x64)

                if [ "$ACTUAL_CHECKSUM" != "$EXPECTED_CHECKSUM_X64" ]; then
                    echo "✗ Checksum verification failed for ttyd-x64!"
                    echo "  Expected: $EXPECTED_CHECKSUM_X64"
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
        fi

        # Check/download ttyd-arm64 (aarch64)
        TTYD_URL_ARM64="https://github.com/$REPO/releases/download/$VERSION/ttyd.aarch64"
        EXPECTED_CHECKSUM_ARM64=$(grep "ttyd.aarch64" SHA256SUMS | cut -d' ' -f1)

        if [[ -f ttyd-arm64 ]]; then
            ACTUAL_CHECKSUM=$(sha256_file ttyd-arm64)
            if [[ "$ACTUAL_CHECKSUM" == "$EXPECTED_CHECKSUM_ARM64" ]]; then
                echo "✓ ttyd-arm64 already cached with matching checksum, skipping download"
            else
                echo "Local ttyd-arm64 checksum mismatch, re-downloading..."
                rm -f ttyd-arm64
            fi
        fi

        if [[ ! -f ttyd-arm64 ]]; then
            echo "Downloading ttyd.aarch64..."
            if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o ttyd-arm64 "$TTYD_URL_ARM64"; then
                echo "✓ Downloaded ttyd-arm64"

                # Verify checksum
                ACTUAL_CHECKSUM=$(sha256_file ttyd-arm64)

                if [ "$ACTUAL_CHECKSUM" != "$EXPECTED_CHECKSUM_ARM64" ]; then
                    echo "✗ Checksum verification failed for ttyd-arm64!"
                    echo "  Expected: $EXPECTED_CHECKSUM_ARM64"
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
        fi

        # Clean up SHA256SUMS file
        rm -f SHA256SUMS

        echo "✓ ttyd download completed successfully"
    } &>"$log_file"

    local exit_status=$?
    if [[ -f "$log_file" ]]; then
        cat "$log_file"
    fi
    return $exit_status
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
        if ! command -v jq &>/dev/null; then
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

        # Check/download claude-linux-x64
        CLAUDE_URL_X64="$GCS_BUCKET/$CLAUDE_VERSION/linux-x64/claude"

        if [[ -f claude-x64 ]]; then
            ACTUAL_CHECKSUM=$(sha256_file claude-x64)
            if [[ "$ACTUAL_CHECKSUM" == "$CHECKSUM_X64" ]]; then
                echo "✓ claude-x64 already cached with matching checksum, skipping download"
            else
                echo "Local claude-x64 checksum mismatch, re-downloading..."
                rm -f claude-x64
            fi
        fi

        if [[ ! -f claude-x64 ]]; then
            echo "Downloading claude-linux-x64..."
            if curl -fsSL -o claude-x64 "$CLAUDE_URL_X64"; then
                echo "✓ Downloaded claude-x64"

                # Verify checksum
                ACTUAL_CHECKSUM=$(sha256_file claude-x64)
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
        fi

        # Check/download claude-linux-arm64
        CLAUDE_URL_ARM64="$GCS_BUCKET/$CLAUDE_VERSION/linux-arm64/claude"

        if [[ -f claude-arm64 ]]; then
            ACTUAL_CHECKSUM=$(sha256_file claude-arm64)
            if [[ "$ACTUAL_CHECKSUM" == "$CHECKSUM_ARM64" ]]; then
                echo "✓ claude-arm64 already cached with matching checksum, skipping download"
            else
                echo "Local claude-arm64 checksum mismatch, re-downloading..."
                rm -f claude-arm64
            fi
        fi

        if [[ ! -f claude-arm64 ]]; then
            echo "Downloading claude-linux-arm64..."
            if curl -fsSL -o claude-arm64 "$CLAUDE_URL_ARM64"; then
                echo "✓ Downloaded claude-arm64"

                # Verify checksum
                ACTUAL_CHECKSUM=$(sha256_file claude-arm64)
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
        fi

        echo "✓ Claude Code download completed successfully"
    } &>"$log_file"

    local exit_status=$?
    if [[ -f "$log_file" ]]; then
        cat "$log_file"
    fi
    return $exit_status
}

# Function to download Codex binaries
download_codex() {
    local log_file="$LOG_DIR/codex.log"
    {
        echo "=== Downloading Codex binaries ==="

        REPO="openai/codex"

        echo "Getting latest Codex version..."
        CODEX_TAG=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

        if [ -z "$CODEX_TAG" ]; then
            echo "✗ Failed to get latest Codex version!"
            return 1
        fi

        # Ensure the rust- prefix is present
        if [[ "$CODEX_TAG" != rust-* ]]; then
            CODEX_VERSION="rust-${CODEX_TAG}"
        else
            CODEX_VERSION="$CODEX_TAG"
        fi

        echo "Latest Codex version: $CODEX_VERSION"

        echo "Downloading codex-linux-x64..."
        CODEX_URL_X64="https://github.com/$REPO/releases/download/${CODEX_VERSION}/codex-x86_64-unknown-linux-gnu.tar.gz"
        if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o codex-x64.tar.gz "$CODEX_URL_X64"; then
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
        if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o codex-arm64.tar.gz "$CODEX_URL_ARM64"; then
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
    } &>"$log_file"

    local exit_status=$?
    if [[ -f "$log_file" ]]; then
        cat "$log_file"
    fi
    return $exit_status
}

# Function to build Gemini CLI binaries
build_gemini() {
    local log_file="$LOG_DIR/gemini.log"
    {
        echo "=== Building Gemini CLI ==="

        REPO="google-gemini/gemini-cli"

        echo "Getting latest Gemini CLI version..."
        GEMINI_VERSION=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')

        if [ -z "$GEMINI_VERSION" ]; then
            echo "✗ Failed to get latest Gemini CLI version!"
            return 1
        fi

        echo "Latest Gemini CLI version: $GEMINI_VERSION"

        echo "Downloading gemini.js..."
        GEMINI_URL="https://github.com/$REPO/releases/download/${GEMINI_VERSION}/gemini.js"
        if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o gemini.js "$GEMINI_URL"; then
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
    } &>"$log_file"

    local exit_status=$?
    if [[ -f "$log_file" ]]; then
        cat "$log_file"
    fi
    return $exit_status
}

# Function to download Chrome binaries
download_chrome() {
    local log_file="$LOG_DIR/chrome.log"
    {
        echo "=== Downloading Chromium bundles ==="

        # Use Playwright's Chromium builds which include all necessary libraries

        # Chromium for Linux x64
        echo "Downloading Chromium for linux-x64 (Playwright build)..."
        CHROMIUM_URL_X64="https://playwright.azureedge.net/builds/chromium/1148/chromium-linux.zip"
        if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o chromium-x64.zip "$CHROMIUM_URL_X64"; then
            echo "✓ Downloaded chromium-x64.zip"

            # Extract the entire bundle to a unique directory
            unzip -q chromium-x64.zip -d chrome-linux-x64-tmp
            if [ -d "./chrome-linux-x64-tmp/chrome-linux" ]; then
                # Create tarball of the entire bundle
                tar -czf chrome-x64.tar.gz -C chrome-linux-x64-tmp/chrome-linux .
                chmod +x chrome-x64.tar.gz
                # Clean up
                rm -rf chromium-x64.zip chrome-linux-x64-tmp
                ls -lh ./chrome-x64.tar.gz
            else
                echo "✗ Failed to extract Chromium bundle for x64!"
                rm -rf chromium-x64.zip chrome-linux-x64-tmp
                return 1
            fi
        else
            echo "✗ Failed to download Chromium for x64!"
            return 1
        fi

        # Chromium for Linux ARM64
        echo "Downloading Chromium for linux-arm64 (Playwright build)..."
        CHROMIUM_URL_ARM64="https://playwright.azureedge.net/builds/chromium/1148/chromium-linux-arm64.zip"
        if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o chromium-arm64.zip "$CHROMIUM_URL_ARM64"; then
            echo "✓ Downloaded chromium-arm64.zip"

            # Extract the entire bundle to a unique directory
            unzip -q chromium-arm64.zip -d chrome-linux-arm64-tmp
            if [ -d "./chrome-linux-arm64-tmp/chrome-linux" ]; then
                # Create tarball of the entire bundle
                tar -czf chrome-arm64.tar.gz -C chrome-linux-arm64-tmp/chrome-linux .
                chmod +x chrome-arm64.tar.gz
                # Clean up
                rm -rf chromium-arm64.zip chrome-linux-arm64-tmp
                ls -lh ./chrome-arm64.tar.gz
            else
                echo "✗ Failed to extract Chromium bundle for arm64!"
                rm -rf chromium-arm64.zip chrome-linux-arm64-tmp
                return 1
            fi
        else
            echo "✗ Failed to download Chromium for arm64!"
            return 1
        fi

        echo "✓ Chromium download completed successfully"
    } &>"$log_file"

    local exit_status=$?
    if [[ -f "$log_file" ]]; then
        cat "$log_file"
    fi
    return $exit_status
}

# Function to download Mineflare binaries
download_mineflare() {
    local log_file="$LOG_DIR/mineflare.log"
    {
        echo "=== Downloading mineflare binaries ==="

        REPO="eastlondoner/mineflare-cli"

        echo "Getting latest mineflare version..."
        MINEFLARE_VERSION=$(curl -sSL -H "Accept: application/vnd.github+json" "${GITHUB_AUTH_HEADER[@]}" "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^\"]+)".*/\1/')

        if [ -z "$MINEFLARE_VERSION" ]; then
            echo "✗ Failed to get latest mineflare version!"
            return 1
        fi

        echo "Latest mineflare version: $MINEFLARE_VERSION"

        local archive_x64="mineflare-linux-x64.tar.gz"
        local checksum_x64="mineflare-linux-x64.tar.gz.sha256"
        local binary_x64="mineflare-x64"

        echo "Checking mineflare-linux-x64..."
        MINEFLARE_URL_X64="https://github.com/$REPO/releases/download/${MINEFLARE_VERSION}/mineflare-linux-x64.tar.gz"
        MINEFLARE_SHA_URL_X64="${MINEFLARE_URL_X64}.sha256"

        # Download checksum file first
        if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o "$checksum_x64" "$MINEFLARE_SHA_URL_X64"; then
            expected_sha_x64=$(cut -d' ' -f1 "$checksum_x64")

            # Check if binary already exists with matching checksum
            if [[ -f "$binary_x64" ]]; then
                actual_sha_x64=$(sha256_file "$binary_x64")
                if [[ "$expected_sha_x64" == "$actual_sha_x64" ]]; then
                    echo "✓ $binary_x64 already cached with matching checksum, skipping download"
                    rm -f "$checksum_x64"
                else
                    echo "Local $binary_x64 checksum mismatch, re-downloading..."
                    rm -f "$binary_x64"
                fi
            fi

            # Download if binary doesn't exist or checksum didn't match
            if [[ ! -f "$binary_x64" ]]; then
                echo "Downloading mineflare-linux-x64..."
                if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o "$archive_x64" "$MINEFLARE_URL_X64"; then
                    echo "✓ Downloaded $archive_x64"
                    actual_sha_x64=$(sha256_file "$archive_x64")
                    if [[ "$expected_sha_x64" != "$actual_sha_x64" ]]; then
                        echo "✗ SHA256 mismatch for $archive_x64"
                        echo "  Expected: $expected_sha_x64"
                        echo "  Actual:   $actual_sha_x64"
                        rm -f "$archive_x64" "$checksum_x64"
                        return 1
                    fi
                    tar -xzf "$archive_x64"
                    rm -f "$archive_x64"
                    if [[ -f mineflare-linux-x64 ]]; then
                        mv mineflare-linux-x64 "$binary_x64"
                        chmod +x "$binary_x64"
                        ls -lh ./"$binary_x64"
                    else
                        echo "✗ Extracted archive did not contain mineflare binary"
                        rm -f "$checksum_x64"
                        return 1
                    fi
                else
                    echo "✗ Failed to download mineflare-x64!"
                    rm -f "$checksum_x64"
                    return 1
                fi
            fi
            rm -f "$checksum_x64"
        else
            echo "✗ Failed to download checksum file!"
            return 1
        fi

        local archive_arm64="mineflare-linux-arm64.tar.gz"
        local checksum_arm64="mineflare-linux-arm64.tar.gz.sha256"
        local binary_arm64="mineflare-arm64"

        echo "Checking mineflare-linux-arm64..."
        MINEFLARE_URL_ARM64="https://github.com/$REPO/releases/download/${MINEFLARE_VERSION}/mineflare-linux-arm64.tar.gz"
        MINEFLARE_SHA_URL_ARM64="${MINEFLARE_URL_ARM64}.sha256"

        # Download checksum file first
        if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o "$checksum_arm64" "$MINEFLARE_SHA_URL_ARM64"; then
            expected_sha_arm64=$(cut -d' ' -f1 "$checksum_arm64")

            # Check if binary already exists with matching checksum
            if [[ -f "$binary_arm64" ]]; then
                actual_sha_arm64=$(sha256_file "$binary_arm64")
                if [[ "$expected_sha_arm64" == "$actual_sha_arm64" ]]; then
                    echo "✓ $binary_arm64 already cached with matching checksum, skipping download"
                    rm -f "$checksum_arm64"
                else
                    echo "Local $binary_arm64 checksum mismatch, re-downloading..."
                    rm -f "$binary_arm64"
                fi
            fi

            # Download if binary doesn't exist or checksum didn't match
            if [[ ! -f "$binary_arm64" ]]; then
                echo "Downloading mineflare-linux-arm64..."
                if curl -fsSL "${GITHUB_AUTH_HEADER[@]}" -o "$archive_arm64" "$MINEFLARE_URL_ARM64"; then
                    echo "✓ Downloaded $archive_arm64"
                    actual_sha_arm64=$(sha256_file "$archive_arm64")
                    if [[ "$expected_sha_arm64" != "$actual_sha_arm64" ]]; then
                        echo "✗ SHA256 mismatch for $archive_arm64"
                        echo "  Expected: $expected_sha_arm64"
                        echo "  Actual:   $actual_sha_arm64"
                        rm -f "$archive_arm64" "$checksum_arm64"
                        return 1
                    fi
                    tar -xzf "$archive_arm64"
                    rm -f "$archive_arm64"
                    if [[ -f mineflare-linux-arm64 ]]; then
                        mv mineflare-linux-arm64 "$binary_arm64"
                        chmod +x "$binary_arm64"
                        ls -lh ./"$binary_arm64"
                    else
                        echo "✗ Extracted archive did not contain mineflare ARM64 binary"
                        rm -f "$checksum_arm64"
                        return 1
                    fi
                else
                    echo "✗ Failed to download mineflare ARM64 binary!"
                    rm -f "$checksum_arm64"
                    return 1
                fi
            fi
            rm -f "$checksum_arm64"
        else
            echo "✗ Failed to download checksum file!"
            return 1
        fi
        echo "✓ Mineflare download completed successfully"
    } &>"$log_file"

    local exit_status=$?
    if [[ -f "$log_file" ]]; then
        cat "$log_file"
    fi
    return $exit_status
}

echo ""
echo "Starting parallel builds and downloads..."
echo ""

# Run all tasks in parallel with a retry
if [[ "$OFFLINE_FLAG" != "true" ]]; then

    (build_http_proxy || build_http_proxy) &
    PID_HTTP_PROXY=$!

    (build_file_server || build_file_server) &
    PID_FILE_SERVER=$!

    (download_hteetp || download_hteetp) &
    PID_HTEETP=$!

    (download_ttyd || download_ttyd) &
    PID_TTYD=$!

    (download_claude || download_claude) &
    PID_CLAUDE=$!

    (download_codex || download_codex) &
    PID_CODEX=$!

    (build_gemini || build_gemini) &
    PID_GEMINI=$!

    (download_chrome || download_chrome) &
    PID_CHROME=$!

    (download_mineflare || download_mineflare) &
    PID_MINEFLARE=$!

    # Wait for all tasks and collect exit codes (bash 3.2 compatible)
    PIDS=($PID_HTTP_PROXY $PID_FILE_SERVER $PID_HTEETP $PID_TTYD $PID_CLAUDE $PID_CODEX $PID_GEMINI $PID_CHROME $PID_MINEFLARE)
    TASK_NAMES=("HTTP Proxy build" "File Server build" "hteetp download" "ttyd download" "Claude Code download" "Codex download" "Gemini CLI build" "Chrome download" "mineflare download")
    TASK_STATUS=()

    # Wait for each task and collect status without aborting on failures (set -e safe)
    for pid in "${PIDS[@]}"; do
        if ! wait "$pid"; then
            TASK_STATUS+=(1)
        else
            TASK_STATUS+=(0)
        fi
    done

    # Check if any tasks failed
    FAILED_TASKS=()
    for i in $(seq 0 $((${#PIDS[@]} - 1))); do
        if [ "${TASK_STATUS[$i]}" -ne 0 ]; then
            FAILED_TASKS+=("${TASK_NAMES[$i]}")
        fi
    done

else
    FAILED_TASKS=()
    for binary in "${REQUIRED_FILES[@]}"; do
        if [[ ! -f "$binary" ]]; then
            FAILED_TASKS+=("missing $binary")
        fi
    done
fi

# Summary output
if [[ ${#FAILED_TASKS[@]} -eq 0 ]]; then
    if [[ "$OFFLINE_FLAG" == "true" ]]; then
        echo "✓ All required binaries present for offline mode"
    else
        echo "✓ All binaries built/downloaded successfully!"
    fi
    echo "  - http-proxy-x64, http-proxy-arm64"
    echo "  - file-server-x64, file-server-arm64"
    echo "  - hteetp-linux-x64, hteetp-linux-arm64"
    echo "  - ttyd-x64, ttyd-arm64"
    echo "  - claude-x64, claude-arm64"
    echo "  - codex-x64, codex-arm64"
    echo "  - gemini-x64, gemini-arm64"
    echo "  - chrome-x64, chrome-arm64"
    echo "  - mineflare-x64, mineflare-x64-baseline"
    exit 0
else
    if [[ "$OFFLINE_FLAG" == "true" ]]; then
        echo "✗ Offline build cannot proceed; missing cached binaries:"
    else
        echo "✗ The following tasks failed:"
    fi
    for task in "${FAILED_TASKS[@]}"; do
        echo "  - $task"
    done
    exit 1
fi
