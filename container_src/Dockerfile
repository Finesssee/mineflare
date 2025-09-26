# syntax=docker/dockerfile:1

FROM itzg/minecraft-server:latest

ENV TAILSCALE_STATE_DIR=/var/lib/tailscale/tailscaled.state
ENV SERVER_PORT=8081

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && curl -fsSL https://tailscale.com/install.sh | sh \
    && mkdir -p $(dirname "${TAILSCALE_STATE_DIR}") \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY container_src/start-with-services.sh /usr/local/bin/start-with-services.sh
RUN chmod +x /usr/local/bin/start-with-services.sh

EXPOSE 8080 8081 25565 25575

ENTRYPOINT ["/usr/local/bin/start-with-services.sh"]
CMD ["/image/scripts/start"]
