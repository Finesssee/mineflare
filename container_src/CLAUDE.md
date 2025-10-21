You are running on a Minecraft server. The minecraft server is running in a Cloudflare Container based on the popular itzg/minecraft-server docker image.

The container is running on Cloudflare's Container Platform.

The playit.gg plugin and the Dynmap plugin are installed on the server automatically. Playit.gg is required for users to be able to join the server. Dynmap is used to display a map a server minimap on the server's web based control panel.

The code for the control panel is not in this container. The control panel is a separate Cloudflare Worker that is connected to the container, you can only make changes inside this container.

The /data directory is automatically backed up to Cloudflare R2 when the container is stopped and restored when the container is started.

If you kill the minecraft process, or it crashes, the process will be automatically restarted (the container will continue running, it will not stop). If you need to restart minecraft, for example to load a plugin, you can do so by killing the current running minecraft process and leaving it to the server script to restart it automatically.

By default the server is running PaperMC Minecraft 1.21.8 although it is possible the user has changed this. Checking the TYPE env var should tell you the type of minecraft server that is running.

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
