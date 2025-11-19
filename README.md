

# Mineflare ⛏️☁️

Click this button to deploy to your cloudflare account right now:

[![Deploy to Cloudflare](https://github.com/user-attachments/assets/9d6358a5-2b85-4974-9adb-bd157c311b1f)](https://deploy.workers.cloudflare.com/?url=https://github.com/eastlondoner/mineflare)

Run a full Minecraft Java server on the edge with real-time monitoring, authentication, and plugin management powered by Cloudflare Workers and Containers.

<img width="2052" height="2110" alt="image" src="https://github.com/user-attachments/assets/e02f9313-fe90-4c43-adb8-cec7dbb8b14c" />

🎮 You get a single Cloudflare `standard-4` container with 4 vCPUs, 12 GiB of memory and 20 GB of storage, enough to comfortably accomodate 20 players.
💵 This costs approximately 50 cents per hour to run on Cloudflare. The server automatically shuts down after 20 minutes of inactivity to save costs, your maps and plugin configurations are saved to R2 storage and restored when you start the server again.

⚠️ I am not responsible for any costs associated with running this server! Leaving a Container running 24/7 can cost you $100s per month 💸

## 🚀 Quick Start

Click on the Deploy to Cloudflare button above to deploy to Cloudflare.
The Cloudflare free tier is not supported for Containers so you have an account on the $5/month Cloudflare paid plan (or higher) to deploy.

<img width="1706" height="1011" alt="image" src="https://github.com/user-attachments/assets/fccc7b6c-b690-46af-a05d-b201bef459f4" />

### First-Time Setup

1. Navigate to your deployed worker URL
2. Click "Set Password" to secure your Server with a password
3. Login with your credentials
4. Click "Start Server" to launch the Minecraft container
5. While the server is booting, create a Cloudflare Tunnel that exposes `tcp://localhost:25565` on the hostname you want to use (see **Cloudflare Domain Access** below for a detailed walkthrough).
6. Add the generated token as the `CLOUDFLARE_TUNNEL_TOKEN` secret and set `CLOUDFLARE_TUNNEL_HOSTNAME` to your domain. Redeploy or restart the worker so the container picks up the new credentials.
7. Wait 2-3 minutes for the server to fully initialize. The dashboard will show a **Cloudflare Tunnel** card that turns green when the tunnel is connected.
8. Connect from Minecraft using your Cloudflare hostname (for example `mc.example.com:25565`) and share that hostname with your friends.

## 🌐 Cloudflare Domain Access

The container now ships with `cloudflared`, so you can expose Minecraft directly from Cloudflare's network without third-party relays.

1. Open the Cloudflare dashboard and go to **Zero Trust → Access → Tunnels**.
2. Create a **Cloudflared** tunnel, choose a name (e.g., `mineflare-mc`), and add a public hostname such as `mc.example.com`.
3. Set the service for that hostname to `tcp://localhost:25565`. Cloudflare converts the raw TCP traffic into the secure connection to your container.
4. Copy the one-time tunnel token that Cloudflare generates.
5. In your deployment pipeline (`bun run configure` or the Cloudflare dashboard), set the following variables:
   - `CLOUDFLARE_TUNNEL_TOKEN` (secret) – paste the token from step 4
   - `CLOUDFLARE_TUNNEL_HOSTNAME` – the hostname you mapped in step 2 (e.g., `mc.example.com`)
6. Redeploy or restart the worker. The Mineflare dashboard will display the Cloudflare Tunnel status, including recent logs.
7. Once the status shows **Connected**, join the server from Minecraft using `your-hostname:25565`.
<img width="795" height="490" alt="image" src="https://github.com/user-attachments/assets/303c4a07-8411-4487-acce-9ee23dfef526" />

<img width="850" height="475" alt="image" src="https://github.com/user-attachments/assets/2af59c0c-c5e0-485f-b8ba-1af472dd9094" />

## 🎮 Minecraft Version Support

Mineflare now ships with sixteen curated profiles:

| Profile | Loader | Label | Notes |
|--------|--------|-------|-------|
| Paper 1.21.10 | Paper | Experimental | Latest Paper builds with bleeding-edge gameplay (expect the fastest updates). |
| Paper 1.21.8 *(default)* | Paper | Stable | Recommended for most servers; balanced performance + compatibility. |
| Paper 1.21.7 | Paper | Legacy | Paper build for plugins that haven’t moved past 1.21.7. |
| Paper 1.20.6 | Paper | Legacy | Long-term support release for established plugin stacks. |
| Paper 1.19.4 | Paper | Legacy | Ideal for older adventure maps and plugin ecosystems that have not migrated to 1.20+. |
| Forge 1.20.1 | Forge | Modded | Popular line for large modpacks. Downloads Forge + libraries on first boot. |
| Forge 1.19.2 | Forge | Modded | Modern Create/All The Mods packs still target this long-lived Forge build. |
| Forge 1.18.2 | Forge | Modded | Adventure/RPG modpacks frequently pin this Forge baseline. |
| Forge 1.16.5 | Forge | Modded | Classic kitchen-sink packs (FTB, Valhelsia) stay here for legacy mods. |
| NeoForge 1.21.1 | NeoForge | Modded | Modern NeoForge line for bleeding-edge 1.21.x modpacks. |
| NeoForge 1.20.4 | NeoForge | Modded | Stable NeoForge branch covering the latest Create/questing packs. |
| NeoForge 1.20.1 | NeoForge | Modded | Lets long-lived 1.20.1 NeoForge packs run without redeploying. |
| Fabric 1.21.1 | Fabric | Modded | Lightweight Fabric loader. Includes pinned loader/installer versions. |
| Fabric 1.20.1 | Fabric | Modded | Quilt-compatible Fabric stack, perfect for Sodium/Lithium setup. |
| Fabric 1.19.2 | Fabric | Modded | Performance-focused SMPs and modpacks targeting the 1.19 cycle. |
| Fabric 1.18.2 | Fabric | Modded | Great for Create/Fabric hybrids that rely on this version. |

**Switching Profiles:**
1. Stop your server using the "Stop Server" button.
2. Pick a profile in the "Minecraft Version" card (modded options are tagged in red).
3. Click to apply – state updates instantly without wiping your world files.
4. Start the server. Modded profiles download their distribution during the next startup.

⚠️ **Important:** Always backup your world before switching profiles. Downgrading between vanilla/modded can corrupt chunks if you load them with different content.

### 🧩 Modded Servers (Forge, Fabric & NeoForge)

The new modded presets make Cloudflare Containers viable for modpacks:

1. Choose any Forge (1.16.5 / 1.18.2 / 1.19.2 / 1.20.1), Fabric (1.18.2 / 1.19.2 / 1.20.1 / 1.21.1), or NeoForge (1.20.1 / 1.20.4 / 1.21.1) profile in the version selector (server must be stopped).
2. Upload your mods/datapacks to `/data/mods` and `/data/config` using the built-in file browser, `mineflare` CLI, or your preferred MCP terminal.
3. Start the server – the Forge/Fabric/NeoForge installer runs on boot and consumes whatever you placed under `/data/mods`.
4. When updating modpacks, stop the server, change the files, and start it again.

First boot after switching to a modded profile can take several minutes while Forge/Fabric/NeoForge download their runtime. Subsequent restarts reuse the cached artifacts stored in `/data`.

## ✨ Features

- **🚀 Serverless Infrastructure** - Built on Cloudflare Workers, Containers, Durable Objects and R2
- **🎮 Full Minecraft Server** - Paper/Forge/Fabric/NeoForge multi-version server out of the box
- **🔄 Version Selector** - Switch between Legacy, Stable, and Experimental Minecraft versions without losing data
- **🗺️ Live Mini-Map** - Integrated web Mini-Map on R2 storage
- **🔐 Authentication** - Secure cookie-based auth with encrypted tokens
- **💻 Web Terminal** - Real-time Minecraft control console via WebSocket
- **🔌 Plugin Management** - Enable/disable plugins through web UI
- **🧩 Modded Profiles** - One click Forge/Fabric/NeoForge presets (drop mods into `/data/mods`)
- **🌐 Cloudflare Domains** - Use your own hostname via Cloudflare Tunnel with zero extra binaries
- **💤 Auto-Sleep** - Containers sleep after 20 minutes of inactivity to save resources
- **📊 Real-time Monitoring** - Server status, player list, and performance metrics

<img width="1200" height="630" alt="image" src="https://github.com/user-attachments/assets/3527300e-a3a8-43af-947b-a10e3a5962a0" />

## 🏗️ Architecture

**Core Components:**
- **Main Worker** (`src/worker.ts`) - Elysia API server
- **Frontend** - Preact SPA with Eden Treaty client using polling for real-time updates
- **MinecraftContainer** (`src/container.ts`) - Durable Object managing server lifecycle & security
- **HTTP Proxy** - Custom TCP-to-HTTP bridge in Bun binary allows container to securely connect to R2 via bindings (no R2 tokens needed)
- **Dynmap Worker** - Separate worker serving Mini-Map

## Alternative Networking Options

Cloudflare Tunnels are now the default way to expose Mineflare over the public internet. If you prefer a private network, you can still fall back to Tailscale.

### Using Tailscale for private networking

1. Leave `CLOUDFLARE_TUNNEL_TOKEN` unset so no public hostname is created.
2. Generate a Tailscale authentication key in your Tailscale account settings.
3. Create a `TS_AUTHKEY` *build* secret in your Mineflare worker on Cloudflare and redeploy.
4. Look in your Tailscale dashboard for a new node called "cloudchamber" and copy the private IP address.
5. Connect from Minecraft using the Tailscale IP (`<tailscale-private-ip>:25565`).


## Local Development

### Prerequisites for local development

- [Bun](https://bun.sh) javascript runtime
- Cloudflare account with Workers and R2 enabled

### Development

```bash
# Install dependencies
bun install

# Start local development environment
bun run dev
```

### Deployment from local checkout

```bash
# Configure alchemy
bun run configure

# Login to Alchemy
bun run login

# Deploy to Cloudflare
bun run deploy
```

After deployment, you'll receive URLs for:
- Main worker (API and frontend)
- Dynmap worker (map tiles)

## 🔧 Configuration

### Environment Variables

Required environment variables (set in `.env` file):

```env
# Cloudflare credentials (from Alchemy login)
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token

# Optional: Tailscale for private networking
TS_AUTHKEY=your_tailscale_key

# Optional: Alchemy password for state encryption
ALCHEMY_PASSWORD=your_secure_password

# Optional: Cloudflare Tunnel for public access
CLOUDFLARE_TUNNEL_TOKEN=copy_from_cloudflare_zero_trust
CLOUDFLARE_TUNNEL_HOSTNAME=mc.example.com

# Optional: Cloudflare Access SSH (multi-line keys allowed)
ALLOW_SSH=true
SSH_AUTHORIZED_KEYS="ssh-ed25519 AAAA... user@example"
```

### Container Settings

Configure via the web UI:
- **Minecraft Version** - Pick any Paper/Forge/Fabric/NeoForge profile shown in the dashboard
- **Plugin Management** - Enable/disable optional plugins when server is stopped

Advanced settings in `src/container.ts`:
- `sleepAfter` - Auto-sleep timeout (default: 20 minutes)
- `INIT_MEMORY` / `MAX_MEMORY` - Server memory allocation (default: 5G/11G)
- Plugin environment variable configurations

## 🔌 Plugin System

Mineflare supports optional Minecraft plugins that can be enabled/disabled via the web UI:

**Built-in Plugins:**
- **Dynmap** - Always enabled, provides live web-based map
- Additional optional plugins can be added by dropping `.jar` files into `container_src/optional_plugins`

**Adding Custom Plugins:**

Instructions coming soon....

## 🛡️ Maintenance & Remote Access

- **Cloudflare Access SSH** – Set `ALLOW_SSH=true` and provide your public keys via `SSH_AUTHORIZED_KEYS` (or upload `/data/ssh/authorized_keys`). Cloudflared automatically exposes `ssh://localhost:22` through the same tunnel token, so you can connect with `cloudflared access ssh --hostname ssh.example.com` without opening new ports. Access policies live in Zero Trust → Access → Applications.
- **Maintenance Mode** – Use the new dashboard controls to enter maintenance mode (server must be stopped). This boots the container without Minecraft, enabling SSH/ttyd access plus the file server without risking world corruption. Exiting maintenance stops the container and clears the flag.
- **Embedded Bash Terminal** – The dashboard now embeds the ttyd bash session, so you can run commands without leaving the browser. It shares state with SSH, meaning Cloudflare Access + web terminal both land in the same shell.
- **File Manager** – Browse `/data`, upload/download mods, edit configs, and create folders directly from the UI. Operations are gated behind maintenance mode; when the server is running the controls are read-only to keep the world safe.

## 🛠️ Development Commands

```bash
# Build worker code
bun run build

# Build container services including HTTP proxy binary and File server binary
./docker_src/build-container-services.sh

# Build single multi-version container image with all Paper versions
# Includes 1.19.4, 1.20.6, 1.21.7, 1.21.8, and 1.21.10 in one image
# Builds for both amd64 and arm64 architectures
bun ./docker_src/build.ts

# Destroy deployed resources
bun run destroy

# Show Alchemy version
bun run version
```

### Container Build Process

The container build system (`docker_src/build.ts`) creates a single multi-version image:

- Builds one container image containing five Paper versions (1.21.10, 1.21.8, 1.21.7, 1.20.6, 1.19.4)
- Multi-platform support (linux/amd64, linux/arm64)
- Includes version-specific Dynmap plugins for all Paper versions
- Uses Docker buildx with registry caching for fast rebuilds
- Caches build state to skip unnecessary rebuilds
- The `VERSION` environment variable selects which Paper version runs at container startup
- Image tag is written to `.BASE_DOCKERFILE` for Alchemy

## 📚 Documentation

- [CLAUDE.md](CLAUDE.md) - AI generated technical documentation

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- [Cloudflare Workers](https://workers.cloudflare.com) - Serverless platform
- [Alchemy](https://alchemy.run) - Infrastructure as Code tool
- [itzg/minecraft-server](https://github.com/itzg/docker-minecraft-server) - Docker Minecraft server
- [Dynmap](https://github.com/webbukkit/dynmap) - Live mapping plugin
- [Paper](https://papermc.io) - High-performance Minecraft server
- [Bun](https://bun.sh) - JavaScript runtime

## ⚠️ Important Notes

- Container costs can be significant including CPU, memory, storage and network egress costs. These will apply based on usage (check Cloudflare pricing, leaving a cloudflare container running 24/7 can cost you $100s per month)
- R2 storage has minimal costs (generous free tier)
- Workers have generous free tier (100k requests/day)

## 📞 Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/eastlondoner/mineflare/issues).

---

Made with ☁️ by [eastlondoner](https://github.com/eastlondoner)
