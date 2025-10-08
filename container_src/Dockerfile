# syntax=docker/dockerfile:1

FROM itzg/minecraft-server:latest

ENV TAILSCALE_STATE_DIR=/var/lib/tailscale/tailscaled.state
ENV SERVER_PORT=8081
ENV TYPE=PAPER
# Get the jar from https://www.spigotmc.org/resources/dynmap®.274/updates
# Match the VERSION here (for minecraft version) to the compatible version of Dynmap you downloaded
ENV VERSION=1.21.7
ENV PATH="/data/.local/bin:${PATH}"

# HTTP Proxy configuration - directs all HTTP/HTTPS traffic through the proxy
# AWS_ENDPOINT_URL is set dynamically via container envVars in container.ts
# Defaults to worker URL (/r2 endpoint) or falls back to localhost:3128 if no worker URL available

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        sudo \
    && curl -fsSL https://tailscale.com/install.sh | sh \
    && mkdir -p $(dirname "${TAILSCALE_STATE_DIR}") \
    && mkdir -p /data/plugins \
    && echo "minecraft ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/minecraft \
    && chmod 0440 /etc/sudoers.d/minecraft \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Minecraft plugin development dependencies
COPY setup-paper-dev.sh /tmp/setup-paper-dev.sh
RUN chmod +x /tmp/setup-paper-dev.sh \
    && /tmp/setup-paper-dev.sh --with-maven \
    && rm /tmp/setup-paper-dev.sh

COPY start-with-services.sh /usr/local/bin/start-with-services.sh
COPY dynmap-configuration.txt /dynmap-configuration.txt
COPY Dynmap-3.7-beta-11-spigot.jar /data/plugins/dynmap.jar
COPY optional_plugins/ /data/optional_plugins/
COPY http-proxy-x64 /usr/local/bin/http-proxy-x64
COPY http-proxy-arm64 /usr/local/bin/http-proxy-arm64
COPY file-server-x64 /usr/local/bin/file-server-x64
COPY file-server-arm64 /usr/local/bin/file-server-arm64
COPY hteetp-linux-x64 /usr/local/bin/hteetp-linux-x64
COPY hteetp-linux-arm64 /usr/local/bin/hteetp-linux-arm64
COPY ttyd-x64 /usr/local/bin/ttyd-x64
COPY ttyd-arm64 /usr/local/bin/ttyd-arm64
COPY claude-x64 /usr/local/bin/claude-x64
COPY claude-arm64 /usr/local/bin/claude-arm64
COPY CLAUDE.md /data/CLAUDE.md
RUN chmod +x /usr/local/bin/start-with-services.sh \
    && chmod +x /usr/local/bin/http-proxy-x64 \
    && chmod +x /usr/local/bin/http-proxy-arm64 \
    && chmod +x /usr/local/bin/file-server-x64 \
    && chmod +x /usr/local/bin/file-server-arm64 \
    && chmod +x /usr/local/bin/hteetp-linux-x64 \
    && chmod +x /usr/local/bin/hteetp-linux-arm64 \
    && chmod +x /usr/local/bin/ttyd-x64 \
    && chmod +x /usr/local/bin/ttyd-arm64 \
    && chmod +x /usr/local/bin/claude-x64 \
    && chmod +x /usr/local/bin/claude-arm64 \
    && mkdir -p /run/tailscale \
    && chown -R 1000:1000 /data \
    && chown -R 1000:1000 /run/tailscale

USER 1000:1000

# Create a wrapper script for Claude that detects architecture and runs the correct binary
RUN mkdir -p /data/.local/bin && \
    echo '#!/bin/bash' > /data/.local/bin/claude && \
    echo 'case "$(uname -m)" in' >> /data/.local/bin/claude && \
    echo '    x86_64|amd64) exec /usr/local/bin/claude-x64 --resume --dangerously-skip-permissions "$@" ;;' >> /data/.local/bin/claude && \
    echo '    arm64|aarch64) exec /usr/local/bin/claude-arm64 --resume --dangerously-skip-permissions "$@" ;;' >> /data/.local/bin/claude && \
    echo '    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;' >> /data/.local/bin/claude && \
    echo 'esac' >> /data/.local/bin/claude && \
    chmod +x /data/.local/bin/claude

EXPOSE 8080 8081 8082 8083 8084 8085 8086 8087 8088 8089 8090 8091 8092 8093 8094 8095 8096 8097 8098 8099 8100 8101 8102 8103 8104 8105 8106 8107 8108 8109 8114 25575 7681

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
