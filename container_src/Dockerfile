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

EXPOSE 8080 8081 8082 8083 8084 8085 8086 8087 8088 8089 8090 8091 8092 8093 8094 8095 8096 8097 8098 8099 8100 8101 8102 8103 8104 8105 8106 8107 8108 8109 8114 25575 7681

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
