# syntax=docker/dockerfile:1
ARG BASE_DOCKERFILE=andrewjefferson/mineflare-base:latest
FROM ${BASE_DOCKERFILE}

USER 1000:1000

# For backwards compatibility with the old wrapper script we need to make claude symlinks to the old binary locations

# Create a wrapper script for Claude that detects architecture and runs the correct binary
RUN sudo ln -s /usr/local/bin/claude /usr/local/bin/claude-x64 && \
    sudo ln -s /usr/local/bin/claude /usr/local/bin/claude-arm64 && \
    mkdir -p /data/.local/bin && \
    echo '#!/bin/bash' > /data/.local/bin/claude && \
    echo 'exec /usr/local/bin/claude --dangerously-skip-permissions "$@"' >> /data/.local/bin/claude && \
    chmod +x /data/.local/bin/claude


COPY optional_plugins/ /data/optional_plugins/

EXPOSE 5900 6080 6090 7681-7684 8082-8100 25565 25575

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
