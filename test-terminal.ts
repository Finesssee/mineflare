#!/usr/bin/env bun
/// <reference types="@types/bun" />

import { $ } from "bun";
import { existsSync, readFileSync, mkdtempSync, symlinkSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Local test harness for the terminal interface
 * Runs ttyd services and a dev server with mock backend without Docker
 */

// Change to the repo root
process.chdir(import.meta.dirname);

const DEV_SERVER_PORT = 5173;
const BACKEND_PORT = 3001; // Backend proxy for auth and WebSockets
const TTYD_PORTS = {
  claude: 7681,
  codex: 7682,
  gemini: 7683,
  bash: 7684,
};

// Shared terminal dimensions for ttyd (must match start-with-services.sh)
const TTYD_SESSION_COLS = 160;
const TTYD_SESSION_ROWS = 80;

// Shared terminal theme for ttyd
const TTYD_THEME = JSON.stringify({
  background: "#0a1612",
  foreground: "#e0e0e0",
  cursor: "#55FF55",
  cursorAccent: "#0a1612",
  selectionBackground: "#57A64E"
});

// Track spawned processes and servers
const processes: Array<{ name: string; proc: any }> = [];
let backendServer: any = null;
let tempBinDir: string | null = null;

// Cleanup handler
function cleanup() {
  console.log("\n🛑 Shutting down services...");

  // Stop backend server
  if (backendServer) {
    try {
      backendServer.stop();
      console.log("  ✓ Stopped backend-proxy");
    } catch (error) {
      console.error("  ✗ Failed to stop backend-proxy:", error);
    }
  }

  // Stop all spawned processes
  for (const { name, proc } of processes) {
    try {
      proc.kill();
      console.log(`  ✓ Stopped ${name}`);
    } catch (error) {
      console.error(`  ✗ Failed to stop ${name}:`, error);
    }
  }

  // Clean up temporary directory
  if (tempBinDir) {
    try {
      rmSync(tempBinDir, { recursive: true, force: true });
      console.log("  ✓ Cleaned up temporary directory");
    } catch (error) {
      console.error("  ✗ Failed to clean up temporary directory:", error);
    }
  }

  process.exit(0);
}

// Register cleanup handlers
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

/**
 * Detect the correct ttyd binary for macOS
 * Note: Pre-built macOS binaries are not available from ttyd releases,
 * so we require Homebrew installation
 */
function getTtydBinary(): string {
  // Check if system ttyd is available (Homebrew installation)
  try {
    const result = Bun.spawnSync(["which", "ttyd"]);
    if (result.exitCode === 0) {
      const path = result.stdout.toString().trim();
      console.log(`  ✓ Using system ttyd: ${path}`);
      return "ttyd";
    }
  } catch (error) {
    // System ttyd not found
  }

  // ttyd not found - provide installation instructions
  console.error("\n❌ ttyd not found!");
  console.error("\nttyd is required for the terminal interface.");
  console.error("Please install it via Homebrew:");
  console.error("  brew install ttyd");
  console.error("\nNote: The docker_src/ttyd-* binaries are Linux ELF binaries");
  console.error("and cannot run on macOS.");
  process.exit(1);
}

/**
 * Start a ttyd service for a specific terminal type
 */
async function startTtyd(
  type: string, 
  port: number, 
  command: string | string[], 
  ttydBinary: string,
  extraEnv?: Record<string, string>
) {
  console.log(`🚀 Starting ttyd for ${type} on port ${port} with ${extraEnv ? JSON.stringify(extraEnv) : 'default env'}...`);

  try {
    // Convert command to array if it's a string
    const commandArgs = typeof command === "string" ? command.split(" ") : command;
    
    const printenv = await Bun.spawn(["printenv"], {
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        ...extraEnv,
        "TEST_TERMINAL": "true"
      }
    });


    const proc = Bun.spawn([
      ttydBinary,
      "--port", port.toString(),
      "--interface", "127.0.0.1",
      "--base-path", `/src/terminal/${type}`,
      "-Q",  // Shared PTY mode
      "--session-width", TTYD_SESSION_COLS.toString(),
      "--session-height", TTYD_SESSION_ROWS.toString(),
      "--writable",
      "--client-option", "fontSize=14",
      "--client-option", `theme=${TTYD_THEME}`,
      ...commandArgs
    ], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...extraEnv,
        "TEST_TERMINAL": "true"
      }
    });

    processes.push({ name: `ttyd-${type}`, proc });

    // Give ttyd a moment to start
    await Bun.sleep(500);

    console.log(`  ✓ ttyd for ${type} started on http://127.0.0.1:${port}`);
    return proc;
  } catch (error) {
    console.error(`  ✗ Failed to start ttyd for ${type}:`, error);
    throw error;
  }
}

/**
 * Start a backend proxy server for auth and WebSocket forwarding
 */
async function startBackendProxy() {
  console.log(`🔧 Starting backend proxy on port ${BACKEND_PORT}...`);

  const server = Bun.serve<{ url: string }>({
    port: BACKEND_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": `http://localhost:${DEV_SERVER_PORT}`,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Credentials": "true",
          },
        });
      }

      // Mock auth token endpoint - return a fake token
      if (url.pathname === "/auth/ws-token") {
        return new Response(JSON.stringify({ token: "local-test-token" }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": `http://localhost:${DEV_SERVER_PORT}`,
            "Access-Control-Allow-Credentials": "true",
          },
        });
      }

      // Proxy WebSocket connections to ttyd
      if (url.pathname.startsWith("/src/terminal/") && url.pathname.endsWith("/ws")) {
        const terminalMatch = url.pathname.match(/\/src\/terminal\/(\w+)\/ws$/);
        if (terminalMatch) {
          const terminalType = terminalMatch[1] as keyof typeof TTYD_PORTS;
          const ttydPort = TTYD_PORTS[terminalType];

          if (ttydPort && req.headers.get("upgrade") === "websocket") {
            // Upgrade the connection with request URL as data
            const upgraded = server.upgrade(req, {
              data: { url: req.url }
            });
            if (!upgraded) {
              return new Response("WebSocket upgrade failed", { status: 400 });
            }
            return undefined;
          }
        }
      }

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        // Get terminal type from the connection URL
        const url = new URL(ws.data?.url || "http://localhost");
        const terminalMatch = url.pathname.match(/\/src\/terminal\/(\w+)\/ws$/);

        if (terminalMatch) {
          const terminalType = terminalMatch[1] as keyof typeof TTYD_PORTS;
          const ttydPort = TTYD_PORTS[terminalType];
          const ttydUrl = `ws://127.0.0.1:${ttydPort}${url.pathname}${url.search}`;

          // Connect to ttyd backend
          const ttydWs = new WebSocket(ttydUrl, ["tty"]);

          // Store ttyd WebSocket reference
          (ws as any).ttydWs = ttydWs;

          // Forward messages from ttyd to client
          ttydWs.onmessage = (event) => {
            try {
              ws.send(event.data);
            } catch (error) {
              console.error(`Error forwarding from ttyd to client:`, error);
            }
          };

          ttydWs.onopen = () => {
            console.log(`  🔗 WebSocket proxy established for ${terminalType}`);
          };

          ttydWs.onerror = (error) => {
            console.error(`  ✗ ttyd WebSocket error for ${terminalType}:`, error);
            ws.close();
          };

          ttydWs.onclose = () => {
            ws.close();
          };
        }
      },
      message(ws, message) {
        // Forward messages from client to ttyd
        const ttydWs = (ws as any).ttydWs;
        if (ttydWs && ttydWs.readyState === WebSocket.OPEN) {
          ttydWs.send(message);
        }
      },
      close(ws) {
        // Close ttyd connection
        const ttydWs = (ws as any).ttydWs;
        if (ttydWs) {
          ttydWs.close();
        }
      },
    },
  });

  console.log(`  ✓ Backend proxy started on http://localhost:${BACKEND_PORT}`);
  return server;
}

/**
 * Start Bun's dev server for the terminal interface
 */
async function startDevServer() {
  console.log(`🌐 Starting Bun dev server on port ${DEV_SERVER_PORT}...`);

  try {
    const proc = Bun.spawn([
      "bun",
      "--hot",
      "run",
      "--port", DEV_SERVER_PORT.toString(),
      "src/terminal/index.html"
    ], {
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        PORT: DEV_SERVER_PORT.toString(),
        BUN_PUBLIC_BACKEND_URL: `http://localhost:${BACKEND_PORT}`
      }
    });

    processes.push({ name: "dev-server", proc });

    // Wait a bit for server to start
    await Bun.sleep(1000);

    console.log(`  ✓ Dev server started on http://localhost:${DEV_SERVER_PORT}`);
    console.log(`  ✓ Backend API available at http://localhost:${BACKEND_PORT}`);
    return proc;
  } catch (error) {
    console.error(`  ✗ Failed to start dev server:`, error);
    throw error;
  }
}

/**
 * Check if required binaries are available
 */
function checkBinaries() {
  console.log("🔍 Checking required binaries...");

  const binaries = {
    claude: "claude",
    codex: "codex",
    bash: "bash"
  };

  const missing: string[] = [];

  for (const [name, cmd] of Object.entries(binaries)) {
    try {
      const result = Bun.spawnSync(["which", cmd]);
      if (result.exitCode === 0) {
        const path = result.stdout.toString().trim();
        console.log(`  ✓ ${name}: ${path}`);
      } else {
        console.warn(`  ⚠️  ${name}: not found (${cmd})`);
        missing.push(name);
      }
    } catch (error) {
      console.warn(`  ⚠️  ${name}: not found (${cmd})`);
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    console.error(`\n❌ Missing required binaries: ${missing.join(", ")}`);
    console.error("\nInstallation instructions:");
    if (missing.includes("claude")) {
      console.error("  claude: See https://github.com/anthropics/claude-cli");
    }
    if (missing.includes("codex")) {
      console.error("  codex:  See https://github.com/openai/codex-cli");
    }
    process.exit(1);
  }

  console.log();
}

/**
 * Main entry point
 */
async function main() {
  console.log("🚀 Mineflare Terminal Test Harness\n");

  // Check binaries
  checkBinaries();

  // Detect ttyd binary
  const ttydBinary = getTtydBinary();
  console.log();

  // Create temporary directory with symlink for gemini binary
  const geminiBinaryPath = join(process.cwd(), "docker_src", `gemini-darwin-arm64`);
  tempBinDir = mkdtempSync(join(tmpdir(), "mineflare-gemini-"));
  const geminiSymlinkPath = join(tempBinDir, "gemini");
  
  try {
    symlinkSync(geminiBinaryPath, geminiSymlinkPath);
    console.log(`  ℹ️  Created gemini symlink: ${geminiSymlinkPath} -> ${geminiBinaryPath}\n`);
  } catch (error) {
    console.error(`  ✗ Failed to create gemini symlink:`, error);
    throw error;
  }

  // Start backend proxy for auth and WebSocket forwarding
  backendServer = await startBackendProxy();

  // Start ttyd services BEFORE dev server to avoid race conditions
  await startTtyd("claude", TTYD_PORTS.claude, "claude", ttydBinary);
  await startTtyd("codex", TTYD_PORTS.codex, "codex", ttydBinary);

  // Start gemini with modified PATH to include the symlink directory
  const geminiEnv = {
    PATH: `${tempBinDir}:${process.env.PATH}`,
    PS1: "[gemini] \\w $ "
  };
  await startTtyd("gemini", TTYD_PORTS.gemini, "bash", ttydBinary, geminiEnv);

  await startTtyd("bash", TTYD_PORTS.bash, "bash", ttydBinary);

  // Start Bun dev server AFTER ttyd services are ready
  await startDevServer();

  console.log("\n✨ All services started successfully!");
  console.log("\n📋 Access the terminal interface:");
  console.log(`  🌐 Main Interface: http://localhost:${DEV_SERVER_PORT}`);
  console.log("\n📋 Direct ttyd access (for debugging):");
  console.log(`  Claude: http://127.0.0.1:${TTYD_PORTS.claude}/src/terminal/claude`);
  console.log(`  Codex:  http://127.0.0.1:${TTYD_PORTS.codex}/src/terminal/codex`);
  console.log(`  Gemini: http://127.0.0.1:${TTYD_PORTS.gemini}/src/terminal/gemini`);
  console.log(`  Bash:   http://127.0.0.1:${TTYD_PORTS.bash}/src/terminal/bash`);
  console.log("\n💡 Press Ctrl+C to stop all services\n");

  // Keep the script running
  await new Promise(() => {});
}

// Run the main function
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  cleanup();
  process.exit(1);
});
