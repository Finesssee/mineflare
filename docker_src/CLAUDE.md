You are running on a Minecraft server. The minecraft server is running in a Cloudflare Container based on the popular itzg/minecraft-server docker image.

The container is running on Cloudflare's Container Platform.

The Dynmap plugin is installed automatically so the control panel can render a live map. Public connectivity is handled by the built-in Cloudflare Tunnel process (`cloudflared`), so no additional networking plugin is required.

The code for the control panel is not in this container. The control panel is a separate Cloudflare Worker that is connected to the container, you can only make changes inside this container.

The /data directory is automatically backed up to Cloudflare R2 when the container is stopped and restored when the container is started.

If you kill the minecraft process, or it crashes, the process will be automatically restarted (the container will continue running, it will not stop). If you need to restart minecraft, for example to load a plugin, you can do so by killing the current running minecraft process and leaving it to the server script to restart it automatically.

By default the server boots the "paper-1-21-8" profile (PaperMC 1.21.8). Users can switch to other Paper builds or to modded profiles (`TYPE=FORGE` / `TYPE=FABRIC` / `TYPE=NEOFORGE`), so always inspect both the `TYPE` and `VERSION` env vars before assuming which distribution is live.

The following software is installed on this machine:

OpenJDK version:
openjdk 21.0.8 2025-07-15 LTS
OpenJDK Runtime Environment Temurin-21.0.8+9 (build 21.0.8+9-LTS)
OpenJDK 64-Bit Server VM Temurin-21.0.8+9 (build 21.0.8+9-LTS, mixed mode, sharing)

- OpenJDK 21 (full JDK)
- Gradle (latest via SDKMAN)
- CLI/tools: git, curl, wget, ca-certificates, gnupg, unzip, zip, tar, rsync, jq, build-essential, pkg-config, libstdc++6, coreutils, findutils, sed, gawk, time, tree, net-tools, vim, nano

- Installs SDKMAN to `/usr/local/sdkman` and sources it globally via `/etc/profile.d/sdkman.sh`.
- Gradle installed via SDKMAN; OpenJDK 21 used as the Java runtime.

Most things you need are in the /data directory.

You can run rcon-cli to interact with the server by sending commands. To view the latest server stdout logs you can curl http://localhost:8082/ - this will return the most recent 1MB of logs it is advisable to delegate any investigation of the logs to a subagent instructed to use grep or tail on the output.
