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
    && rm -rf /var/lib/apt/lists/*

# Pre-download Paper MC 1.21.7 during build to avoid runtime downloads
# This significantly reduces container startup time
# The mc-image-helper uses .skipExisting(true) internally, so runtime startup
# will detect the pre-downloaded jar and skip re-downloading it
RUN /usr/bin/mc-image-helper install-paper \
    --project=paper \
    --version=1.21.7 \
    --output-directory=/data \
    --results-file=/data/.paper.env \
    && chown -R 1000:1000 /data

# Install Minecraft plugin development dependencies
COPY --chmod=755 setup-paper-dev.sh /tmp/setup-paper-dev.sh
RUN bash /tmp/setup-paper-dev.sh && rm -rf /var/lib/apt/lists/*

COPY --chmod=755 start-with-services.sh /usr/local/bin/start-with-services.sh
COPY dynmap-configuration.txt /dynmap-configuration.txt
COPY Dynmap-3.7-beta-11-spigot.jar /data/plugins/dynmap.jar
COPY --chmod=755 http-proxy-x64 /usr/local/bin/http-proxy-x64
COPY --chmod=755 http-proxy-arm64 /usr/local/bin/http-proxy-arm64
COPY --chmod=755 file-server-x64 /usr/local/bin/file-server-x64
COPY --chmod=755 file-server-arm64 /usr/local/bin/file-server-arm64
COPY --chmod=755 hteetp-linux-x64 /usr/local/bin/hteetp-linux-x64
COPY --chmod=755 hteetp-linux-arm64 /usr/local/bin/hteetp-linux-arm64
COPY --chmod=755 ttyd-x64 /usr/local/bin/ttyd-x64
COPY --chmod=755 ttyd-arm64 /usr/local/bin/ttyd-arm64
COPY --chmod=755 claude-x64 /usr/local/bin/claude-x64
COPY --chmod=755 claude-arm64 /usr/local/bin/claude-arm64
COPY --chmod=755 codex-x64 /usr/local/bin/codex-x64
COPY --chmod=755 codex-arm64 /usr/local/bin/codex-arm64
COPY --chmod=755 gemini-x64 /usr/local/bin/gemini-x64
COPY --chmod=755 gemini-arm64 /usr/local/bin/gemini-arm64
COPY CLAUDE.md /data/CLAUDE.md
RUN mkdir -p /run/tailscale \
    && chown -R 1000:1000 /data \
    && chown -R 1000:1000 /run/tailscale

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
