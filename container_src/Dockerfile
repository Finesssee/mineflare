# syntax=docker/dockerfile:1
ARG BASE_DOCKERFILE=andrewjefferson/mineflare-base:latest
FROM ${BASE_DOCKERFILE}

USER 1000:1000

# Create a wrapper script for Claude that detects architecture and runs the correct binary
RUN mkdir -p /data/.local/bin && \
    echo '#!/bin/bash' > /data/.local/bin/claude && \
    echo 'case "$(uname -m)" in' >> /data/.local/bin/claude && \
    echo '    x86_64|amd64) exec /usr/local/bin/claude-x64 --dangerously-skip-permissions "$@" ;;' >> /data/.local/bin/claude && \
    echo '    arm64|aarch64) exec /usr/local/bin/claude-arm64 --dangerously-skip-permissions "$@" ;;' >> /data/.local/bin/claude && \
    echo '    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;' >> /data/.local/bin/claude && \
    echo 'esac' >> /data/.local/bin/claude && \
    chmod +x /data/.local/bin/claude


COPY optional_plugins/ /data/optional_plugins/

EXPOSE 5900 6080 6090 7681-7684 8082-8100 25565 25575

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
