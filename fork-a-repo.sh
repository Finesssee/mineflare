#!/bin/bash

# Script to mark a GitHub repository as a fork of another repository
# Requires: gh CLI (GitHub CLI) to be installed and authenticated

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_error() {
    echo -e "${RED}ERROR: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}SUCCESS: $1${NC}"
}

print_info() {
    echo -e "${YELLOW}INFO: $1${NC}"
}

# Check if gh is installed
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) is not installed. Please install it first."
    echo "Visit: https://cli.github.com/"
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    print_error "Not authenticated with GitHub CLI. Please run 'gh auth login' first."
    exit 1
fi

# Get input parameters
if [ $# -eq 2 ]; then
    YOUR_REPO="$1"
    PARENT_REPO="$2"
else
    echo "Usage: $0 <your-repo> <parent-repo>"
    echo ""
    echo "Examples:"
    echo "  $0 username/my-repo original-owner/original-repo"
    echo "  $0 my-repo original-owner/original-repo  (uses current authenticated user)"
    echo ""
    read -p "Enter your repository (owner/repo or just repo): " YOUR_REPO
    read -p "Enter the parent repository (owner/repo): " PARENT_REPO
fi

# If YOUR_REPO doesn't contain a slash, prepend the current user
if [[ ! "$YOUR_REPO" =~ / ]]; then
    CURRENT_USER=$(gh api user -q .login)
    YOUR_REPO="$CURRENT_USER/$YOUR_REPO"
    print_info "Using full repository path: $YOUR_REPO"
fi

print_info "Attempting to mark '$YOUR_REPO' as a fork of '$PARENT_REPO'..."

# Verify both repositories exist
print_info "Verifying repositories exist..."

if ! gh repo view "$YOUR_REPO" &> /dev/null; then
    print_error "Repository '$YOUR_REPO' not found or not accessible."
    exit 1
fi

if ! gh repo view "$PARENT_REPO" &> /dev/null; then
    print_error "Parent repository '$PARENT_REPO' not found or not accessible."
    exit 1
fi

print_success "Both repositories verified."

# Use gh api to update the repository
print_info "Updating fork relationship via GitHub API..."

RESPONSE=$(gh api \
    --method PATCH \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "/repos/$YOUR_REPO" \
    -f "parent=$PARENT_REPO" 2>&1) || {
    print_error "Failed to update fork relationship."
    echo "$RESPONSE"
    echo ""
    print_info "This might not be supported by the API. Consider contacting GitHub Support:"
    echo "https://support.github.com/contact"
    exit 1
}

print_success "Repository '$YOUR_REPO' has been marked as a fork of '$PARENT_REPO'!"
print_info "Check your repository on GitHub to see the fork badge."
