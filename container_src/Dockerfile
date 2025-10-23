# syntax=docker/dockerfile:1
ARG BASE_DOCKERFILE=andrewjefferson/mineflare-base:latest
FROM ${BASE_DOCKERFILE}

# Set XDG_DATA_HOME for all AI CLIs to use /data/.local
ENV XDG_DATA_HOME=/data/.local
ENV XDG_CONFIG_HOME=/data/.config
ENV XDG_CACHE_HOME=/data/.cache

USER 1000:1000

# Create symlink from /home/minecraft to /data and set HOME - note this is NOT creating a circular reference
# it just ensures we persist all HOME data in the expected mount point
RUN sudo ln -sf /data /home/minecraft
ENV HOME=/home/minecraft

# For backwards compatibility with the old wrapper script we need to make claude symlinks to the old binary locations
RUN sudo ln -s /usr/local/bin/claude /usr/local/bin/claude-x64 && \
    sudo ln -s /usr/local/bin/claude /usr/local/bin/claude-arm64 && \
    mkdir -p /data/.local/bin && \
    echo '#!/bin/bash' > /data/.local/bin/claude && \
    echo 'exec /usr/local/bin/claude --dangerously-skip-permissions "$@"' >> /data/.local/bin/claude && \
    chmod +x /data/.local/bin/claude

COPY CLAUDE.md /data/CLAUDE.md
COPY CLAUDE.md /data/GEMINI.md
COPY CLAUDE.md /data/AGENTS.md
COPY CLAUDE.md /data/CODEX.md
COPY optional_plugins/ /data/optional_plugins/

# Create directories for AI CLI history and data storage
RUN mkdir -p /data/.local/gemini/checkpoints \
    /data/.local/codex \
    /data/.local/claude

# Configure Gemini CLI for maximum autonomy
RUN sudo mkdir -p /etc/gemini-cli/ && sudo chmod 755 /etc/gemini-cli/
COPY gemini-settings.json /etc/gemini-cli/system-defaults.json

# Configure Codex CLI for maximum autonomy
# Place config in /data/.local/codex since CODEX_HOME will be set to this location
RUN mkdir -p /data/.local/codex
COPY codex-config.toml /data/.local/codex/config.toml

EXPOSE 5900 6080 6090 7681-7684 8082-8100 25565 25575

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
