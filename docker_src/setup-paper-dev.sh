#!/usr/bin/env bash
set -euo pipefail

# Container-optimized Paper plugin dev environment setup
# - Installs OpenJDK 21 (full), Gradle (via SDKMAN), and common CLI tools
# - Optional: Maven
#
# Usage:
#   ./setup-paper-dev.sh [--with-maven] [--minimal]
#
# Notes:
# - Gradle is installed via SDKMAN to keep it current
# - JDK: system package openjdk-21-jdk (full, not headless)
# - Designed for container environments (no systemctl, no Docker option)

WITH_MAVEN=false
MINIMAL=false

for arg in "$@"; do
  case "$arg" in
    --with-maven) WITH_MAVEN=true ;;
    --minimal) MINIMAL=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

log() { echo -e "\033[1;32m[setup]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn ]\033[0m $*" >&2; }
err() { echo -e "\033[1;31m[error]\033[0m $*" >&2; }

require_sudo() {
  if [[ $EUID -ne 0 ]]; then
    err "Please run as root or with sudo."
    exit 1
  fi
}

apt_install() {
  log "Installing core packages ..."
  # Idempotent apt installs
  DEBIAN_FRONTEND=noninteractive apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openjdk-21-jdk \
    git curl wget ca-certificates gnupg \
    unzip zip tar rsync jq \
    build-essential pkg-config \
    libstdc++6 coreutils findutils sed gawk \
    time tree net-tools vim nano
  
  # Clean up apt cache to reduce image size
  apt-get clean
  rm -rf /var/lib/apt/lists/*
}

set_java_home_profile() {
  log "Configuring JAVA_HOME ..."
  # Try to locate JAVA_HOME from update-alternatives or javac path
  local javac_path
  if javac_path="$(readlink -f "$(command -v javac)")" 2>/dev/null; then
    local java_home
    java_home="$(dirname "$(dirname "$javac_path")")"
    if [[ -n "$java_home" && -d "$java_home" ]]; then
      cat >/etc/profile.d/java21.sh <<EOF
# Added by setup-paper-dev.sh
export JAVA_HOME="$java_home"
export PATH="\$JAVA_HOME/bin:\$PATH"
EOF
      chmod 0644 /etc/profile.d/java21.sh
      log "JAVA_HOME set to $java_home (via /etc/profile.d/java21.sh)."
      return
    fi
  fi
  warn "Could not automatically determine JAVA_HOME; ensure it's set in your shell if needed."
}

install_sdkman_and_gradle() {
  log "Installing SDKMAN! and Gradle ..."
  # Install SDKMAN non-interactively (for Gradle)
  export SDKMAN_DIR="/usr/local/sdkman"
  export SDKMAN_NON_INTERACTIVE="true"

  if [[ ! -d "$SDKMAN_DIR" ]]; then
    log "Installing SDKMAN! to $SDKMAN_DIR ..."
    curl -sS "https://get.sdkman.io" | bash
    # Move to /usr/local if installed under root's $HOME
    if [[ -d "$HOME/.sdkman" && "$HOME/.sdkman" != "$SDKMAN_DIR" ]]; then
      mv "$HOME/.sdkman" "$SDKMAN_DIR"
    fi
  else
    log "SDKMAN! already present at $SDKMAN_DIR"
  fi

  # Ensure global profile sourcing
  cat >/etc/profile.d/sdkman.sh <<'EOF'
# SDKMAN global init
export SDKMAN_DIR="/usr/local/sdkman"
[[ -s "$SDKMAN_DIR/bin/sdkman-init.sh" ]] && source "$SDKMAN_DIR/bin/sdkman-init.sh"
EOF
  chmod 0644 /etc/profile.d/sdkman.sh

  # Load SDKMAN in this shell to proceed
  # Temporarily disable unbound variable checking for SDKMAN init
  set +u
  # shellcheck disable=SC1091
  source "$SDKMAN_DIR/bin/sdkman-init.sh"
  set -u

  # Install/upgrade Gradle (latest stable)
  if ! command -v gradle >/dev/null 2>&1; then
    log "Installing latest Gradle via SDKMAN! ..."
    # Disable unbound variable checking for sdk command
    set +u
    sdk install gradle || { err "Failed to install Gradle via SDKMAN."; exit 1; }
    set -u
  else
    log "Gradle already installed; ensuring it's current ..."
    set +u
    sdk upgrade gradle || true
    set -u
  fi

  # Make SDKMAN accessible to all users
  chmod -R 755 "$SDKMAN_DIR" || true

  log "Keeping system OpenJDK 21 as Java runtime."
}

install_maven_optional() {
  if [[ "$WITH_MAVEN" == "true" && "$MINIMAL" != "true" ]]; then
    log "Installing Maven ..."
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends maven
    apt-get clean
    rm -rf /var/lib/apt/lists/*
  fi
}

tune_system_small() {
  # Helpful tweaks for dev environments (safe defaults)
  # Increase inotify watchers for large Gradle/Multi-module projects
  local limit_file=/etc/sysctl.d/60-inotify.conf
  if [[ ! -f "$limit_file" ]]; then
    mkdir -p /etc/sysctl.d
    cat >"$limit_file" <<EOF
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=1024
EOF
    # In container, sysctl --system might not work, so skip errors
    sysctl --system >/dev/null 2>&1 || true
    log "Adjusted inotify limits for large projects."
  else
    log "Inotify limits already configured."
  fi
}

summary() {
  echo
  log "Setup complete."
  echo "Installed:"
  echo "  - OpenJDK 21 (full JDK)"
  echo "  - Gradle (via SDKMAN; also use Gradle Wrapper per-project)"
  echo "  - CLI tools: git, curl, wget, unzip/zip, rsync, jq, build-essential, vim, etc."
  [[ "$WITH_MAVEN" == "true" && "$MINIMAL" != "true" ]] && echo "  - Maven"
  echo
  echo "Environment:"
  echo "  - JAVA_HOME exported via /etc/profile.d/java21.sh"
  echo "  - SDKMAN sourced via /etc/profile.d/sdkman.sh"
  echo
  echo "Tip: Verify with:"
  echo "  java -version"
  echo "  javac -version"
  echo "  gradle -v"
  if [[ "$WITH_MAVEN" == "true" && "$MINIMAL" != "true" ]]; then
    echo "  - Maven"
    echo "  mvn -v"
  fi
}

main() {
  echo "Setting up paper dev environment ..."
  require_sudo
  echo "Installing core packages ..."
  apt_install
  echo "Setting JAVA_HOME ..."
  set_java_home_profile
  echo "Installing SDKMAN! and Gradle ..."
  install_sdkman_and_gradle
  echo "Installing Maven ..."
  install_maven_optional
  echo "Tuning system ..."
  tune_system_small
  echo "Summary ..."
  summary
  echo "Setup complete."
}

main "$@"
