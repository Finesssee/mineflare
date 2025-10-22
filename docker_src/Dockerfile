# syntax=docker/dockerfile:1.6

# Multi-stage build for Paper MC versions
# Each stage downloads a specific version in parallel

# Stage for Paper 1.21.7
FROM itzg/minecraft-server:latest AS paper-1.21.7
RUN mkdir -p /opt/minecraft/server/1.21.7 && /usr/bin/mc-image-helper install-paper \
    --project=paper \
    --version=1.21.7 \
    --output-directory=/opt/minecraft/server/1.21.7 \
    --results-file=/opt/minecraft/server/1.21.7/.paper-1.21.7.env

# Stage for Paper 1.21.8
FROM itzg/minecraft-server:latest AS paper-1.21.8
RUN mkdir -p /opt/minecraft/server/1.21.8 && /usr/bin/mc-image-helper install-paper \
    --project=paper \
    --version=1.21.8 \
    --output-directory=/opt/minecraft/server/1.21.8 \
    --results-file=/opt/minecraft/server/1.21.8/.paper-1.21.8.env

# Stage for Paper 1.21.10
FROM itzg/minecraft-server:latest AS paper-1.21.10
RUN mkdir -p /opt/minecraft/server/1.21.10 && /usr/bin/mc-image-helper install-paper \
    --project=paper \
    --version=1.21.10 \
    --output-directory=/opt/minecraft/server/1.21.10 \
    --results-file=/opt/minecraft/server/1.21.10/.paper-1.21.10.env

# Final stage - main image
FROM itzg/minecraft-server:latest

# First we do a bunch of heavy lifting to install the dependencies for paper plugin development
# this is first to maximize build caching
COPY --chmod=755 setup-paper-dev.sh /tmp/setup-paper-dev.sh

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
    && bash /tmp/setup-paper-dev.sh \
    && rm -rf /var/lib/apt/lists/*

ENV TAILSCALE_STATE_DIR=/var/lib/tailscale/tailscaled.state
ENV SERVER_PORT=8081
ENV TYPE=PAPER
# Match the VERSION here (for minecraft version) to the compatible version of Dynmap you downloaded
ENV VERSION=1.21.10
ENV PATH="/data/.local/bin:${PATH}"

# Create directories for server jars and plugins outside /data
RUN mkdir -p /opt/minecraft/server /opt/minecraft/plugins

# Copy pre-downloaded Paper versions from build stages
COPY --from=paper-1.21.8 /opt/minecraft/server/1.21.8 /opt/minecraft/server
COPY --from=paper-1.21.10 /opt/minecraft/server/1.21.10 /opt/minecraft/server
COPY --from=paper-1.21.7 /opt/minecraft/server/1.21.7 /opt/minecraft/server
RUN ls -la /opt/minecraft/server && chown -R 1000:1000 /opt/minecraft

COPY --chmod=755 start-with-services.sh /usr/local/bin/start-with-services.sh
COPY dynmap-configuration.txt /dynmap-configuration.txt
# Copy version-specific plugins to /opt/minecraft/plugins (outside /data)
COPY Dynmap-3.7-beta-11-spigot-1.21.10.jar /opt/minecraft/plugins/
COPY Dynmap-3.7-beta-11-spigot-1.21.7.jar /opt/minecraft/plugins/
COPY Dynmap-3.7-beta-11-spigot-1.21.8.jar /opt/minecraft/plugins/

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
    && mkdir -p /data/plugins/spark \
    && echo '{"_header":"spark configuration file - https://spark.lucko.me/docs/Configuration","backgroundProfiler":false}' > /data/plugins/spark/config.json \
    && chown -R 1000:1000 /data \
    && chown -R 1000:1000 /run/tailscale

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
