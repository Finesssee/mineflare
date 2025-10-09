# syntax=docker/dockerfile:1.6

FROM itzg/minecraft-server:latest

ENV TAILSCALE_STATE_DIR=/var/lib/tailscale/tailscaled.state
ENV SERVER_PORT=8081
ENV TYPE=PAPER
# Get the dynmap jar from https://www.spigotmc.org/resources/dynmap®.274/updates
# Match the VERSION here (for minecraft version) to the compatible version of Dynmap you downloaded
ENV VERSION=1.21.7
ENV PATH="/data/.local/bin:${PATH}"

# HTTP Proxy configuration - directs all HTTP/HTTPS traffic through the proxy
# AWS_ENDPOINT_URL is set dynamically via container envVars in container.ts
# Defaults to worker URL (/r2 endpoint) or falls back to localhost:3128 if no worker URL available

RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        sudo \
    && curl -fsSL https://tailscale.com/install.sh | sh \
    && mkdir -p $(dirname "${TAILSCALE_STATE_DIR}") \
    && mkdir -p /data/plugins \
    && echo "minecraft ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/minecraft \
    && chmod 0440 /etc/sudoers.d/minecraft

# Install Minecraft plugin development dependencies
COPY setup-paper-dev.sh /tmp/setup-paper-dev.sh
RUN chmod +x /tmp/setup-paper-dev.sh
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    bash /tmp/setup-paper-dev.sh

COPY start-with-services.sh /usr/local/bin/start-with-services.sh
COPY dynmap-configuration.txt /dynmap-configuration.txt
COPY Dynmap-3.7-beta-11-spigot.jar /data/plugins/dynmap.jar
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

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
