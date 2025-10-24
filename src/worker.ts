import { Elysia, t } from "elysia";
import type { worker } from "../alchemy.run";
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { env as workerEnv } from 'cloudflare:workers'
import cors from "@elysiajs/cors";
import { getNodeEnv } from "./client/utils/node-env";
import { asyncLocalStorage, getMinecraftContainer } from "./server/get-minecraft-container";
import { authApp, requireAuth, decryptToken, getSymKeyCached } from "./server/auth";

const env = workerEnv as typeof worker.Env;


  // Create Elysia app with proper typing for Cloudflare Workers
const elysiaApp = (
  getNodeEnv() === 'development'
  ? new Elysia({
      adapter: CloudflareAdapter,
      // aot: false,
    }).use(cors({
        origin: /^http:\/\/localhost(:\d+)?$/,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
        credentials: true,
        maxAge: 86400,
    }))
  : new Elysia({
      adapter: CloudflareAdapter,
      // aot: false,
    })
  )
  .get("/", () => 'foo')
  .get("/logs", async ({ request }) => {
    console.log("Getting container");
      const container = getMinecraftContainer();
      // This is the only endpoint that starts the container! But also it cannot be used if the container is shutting down.
      const state = await container.getStatus();
      if(state !== "running") {
        return { online: false };
      } else {
        console.log("Getting container");
        const logs = await container.getLogs();
        return { logs };
      }
  })
  /**
   * Get the status of the Minecraft server. This always wakes the server and is the preferred way to wake the server. This may take up to 5 mins to return a value if the server is not already awake.
   */
  .get("/status", async ({ request }) => {
    try {
      console.log("Getting container");
      const container = getMinecraftContainer();
      // This is the only endpoint that starts the container! But also it cannot be used if the container is shutting down.
      const state = await container.getStatus();
      if(state === "stopping") {
        return { online: false };
      }
      if(state !== "running") {
        console.log("Starting container");
        await container.start();
      }
      const response = await container.getRconStatus();
      
      const status = await response;
      return status;
    } catch (error) {
      console.error("Failed to get status", error);
      return { online: false, error: "Failed to get status" };
    }
  })

  /**
   * Get the players of the Minecraft server. This may wake the server if not already awake.
   */
  .get("/players", async ({ request}) => {
    try {
      const container = getMinecraftContainer();
      const response = await container.fetch(new Request("http://localhost/rcon/players"));
      const data = await response.json();
      return data;
    } catch (error) {
      return { players: [], error: "Failed to get players" };
    }
  })

  .get("/container/:id", async ({ params }: any) => {
    try {
      const id = params.id;
      const containerId = env.MINECRAFT_CONTAINER.idFromName(`/container/${id}`);
      const container = env.MINECRAFT_CONTAINER.get(containerId);
      
      // Get both health and RCON status
      const healthResponse = await container.fetch("http://localhost/healthz");
      const statusResponse = await container.fetch("http://localhost/rcon/status");
      const rconStatus = await statusResponse.json() as any;
      
      return {
        id,
        health: healthResponse.ok,
        ...rconStatus
      };
    } catch (error) {
      return { id: params.id, online: false, error: "Failed to get container info" };
    }
  })

  /**
   * Get the info of the Minecraftserver. This may wake the server if not already awake.
   */
  .get("/info", async ({ request }) => {
    try {
      const container = getMinecraftContainer();
      const response = await container.fetch(new Request("http://localhost/rcon/info"));
      const info = await response.json();
      return info;
    } catch (error) {
      return { error: "Failed to get server info" };
    }
  })

  /**
   * Get the Dynmap worker URL for iframe embedding
   */
  .get("/dynmap-url", () => {
    return { url: env.DYNMAP_WORKER_URL };
  })

  /**
   * Get the state of the container ("running" | "stopping" | "stopped" | "healthy" | "stopped_with_code"). This does not wake the container.
   */
  .get("/getState", async ({ request }) => {
    const container = getMinecraftContainer();
    // lastChange: number
    // status: "running" | "stopping" | "stopped" | "healthy" | "stopped_with_code"
    const { lastChange } = await container.getState();
    const status = await container.getStatus();
    return { lastChange, status };
  })

  /**
   * Navigate the embedded browser to a URL
   */
  .post("/browser/navigate", async ({ body, request }: any) => {
    try {
      const { url } = body;
      if (!url || typeof url !== 'string') {
        return { success: false, error: "URL is required" };
      }

      const container = getMinecraftContainer();
      const result = await container.navigateBrowser(url);
      return result;
    } catch (error) {
      console.error("Failed to navigate browser:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to navigate" };
    }
  }, {
    body: t.Object({
      url: t.String(),
    }),
  })

  /**
   * Get the plugin state. Works when container is stopped.
   */
  .get("/plugins", async ({ request }) => {
    try{
      const container = getMinecraftContainer();
      const plugins = await container.getPluginState();
      return { plugins };
    } catch (error) {
      console.error("Failed to get plugin state:", error);
      return { plugins: [], error: "Failed to get plugin state" };
    }
  })

  /**
   * Enable/disable a plugin or set its environment variables.
   * Accepts: { enabled: boolean } | { env: Record<string,string> } | { enabled: boolean, env: Record<string,string> }
   */
  .post("/plugins/:filename", async ({ params, body, request }: any) => {
    try {
      const container = getMinecraftContainer();
      const { filename } = params;
      const { enabled, env } = body as { enabled?: boolean; env?: Record<string, string> };
      
      // If env present, require server stopped
      if (env !== undefined) {
        const state = await container.getStatus();
        if (state !== 'stopped') {
          return { success: false, error: "Server must be stopped to change plugin environment variables" };
        }
        await container.setPluginEnv({ filename, env });
      }
      
      // If enabled present, toggle plugin
      if (enabled !== undefined) {
        if (enabled) {
          await container.enablePlugin({ filename, env });
        } else {
          await container.disablePlugin({ filename });
        }
      }
      
      // Return updated plugin state
      const plugins = await container.getPluginState();
      return { success: true, plugins };
    } catch (error) {
      console.error("Failed to update plugin:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to update plugin" };
    }
  })

  /**
   * Get the current Minecraft server version configuration
   */
  .get("/version", async ({ request }) => {
    try {
      const container = getMinecraftContainer();
      const { version } = await container.getServerVersion();
      const status = await container.getStatus();
      
      // Version labels
      const versionLabels: Record<string, "legacy" | "stable" | "experimental"> = {
        "1.21.7": "legacy",
        "1.21.8": "stable",
        "1.21.10": "experimental",
      };
      
      const supported = [
        { version: "1.21.7", label: "legacy" as const },
        { version: "1.21.8", label: "stable" as const },
        { version: "1.21.10", label: "experimental" as const },
      ];
      
      return {
        version,
        label: versionLabels[version] || "unknown",
        supported,
        canChange: status === 'stopped'
      };
    } catch (error) {
      console.error("Failed to get version:", error);
      return { 
        version: "1.21.8", 
        label: "stable",
        supported: [
          { version: "1.21.7", label: "legacy" as const },
          { version: "1.21.8", label: "stable" as const },
          { version: "1.21.10", label: "experimental" as const },
        ],
        canChange: false,
        error: "Failed to get version" 
      };
    }
  })

  /**
   * Set the Minecraft server version (only allowed when stopped)
   */
  .post("/version", async ({ body, request }: any) => {
    try {
      const { version } = body as { version: string };
      
      if (!version || typeof version !== 'string') {
        return { success: false, error: "Version parameter is required" };
      }
      
      const container = getMinecraftContainer();
      const status = await container.getStatus();
      
      if (status !== 'stopped') {
        return { success: false, error: "Server must be stopped to change version" };
      }
      
      const result = await container.setServerVersion({ version });
      return result;
    } catch (error) {
      console.error("Failed to set version:", error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to set version" 
      };
    }
  })

  /**
   * Execute an RCON command on the Minecraft server
   */
  .post("/rcon/execute", async ({ body, request }: any) => {
    try {
      const { command } = body as { command: string };

      if (!command || typeof command !== 'string') {
        return {
          success: false,
          output: '',
          command: '',
          error: "Command parameter is required and must be a string"
        };
      }

      const container = getMinecraftContainer();
      const result = await container.executeRconCommand(command);
      return result;
    } catch (error) {
      console.error("Failed to execute RCON command:", error);
      return { 
        success: false, 
        output: '',
        command: '',
        error: error instanceof Error ? error.message : "Failed to execute RCON command" 
      };
    }
  })
  
  .post("/shutdown", async ({ request }) => {
    try {
      const container = getMinecraftContainer();
      console.error("Shutting down container");
      await container.stop();
      console.error("Container shut down");
      const state = await container.getStatus();
      console.error("Container state:", state);

      // Get the updated last session info with the new stop time
      const lastSession = await container.getLastSession();

      return { success: true, lastSession };
    } catch (error) {
      console.error("Failed to shutdown container:", error);
      return { success: false, error: "Failed to shutdown container" };
    }
  })

  /**
   * Get current session info (running or not)
   */
  .get("/session/current", async ({ request }) => {
    try {
      const container = getMinecraftContainer();
      const session = await container.getCurrentSession();
      return session;
    } catch (error) {
      console.error("Failed to get current session:", error);
      return { isRunning: false, error: "Failed to get current session" };
    }
  })

  /**
   * Get last completed session info
   */
  .get("/session/last", async ({ request }) => {
    try {
      const container = getMinecraftContainer();
      const session = await container.getLastSession();
      return session || { error: "No previous sessions" };
    } catch (error) {
      console.error("Failed to get last session:", error);
      return { error: "Failed to get last session" };
    }
  })

  /**
   * Get usage statistics (hours this month and year)
   */
  .get("/session/stats", async ({ request }) => {
    try {
      const container = getMinecraftContainer();
      const stats = await container.getUsageStats();
      return stats;
    } catch (error) {
      console.error("Failed to get usage stats:", error);
      return { thisMonth: 0, thisYear: 0, error: "Failed to get usage stats" };
    }
  })
  .get("/startup-status", async ({ request }) => {
    try {
      const container = getMinecraftContainer();
      const response = await container.fetch(new Request("http://localhost/startup-status"));
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Failed to get startup status", error);
      return { status: 'stopped', startupStep: null, error: "Failed to get startup status" };
    }
  })

  .compile()

const app = new Elysia({
  adapter: CloudflareAdapter,
  // aot: false,
}).mount('/api', elysiaApp)
  .mount('/auth', authApp)
  .compile()

export { MinecraftContainer } from "./container";

/**
 * Validates WebSocket authentication token from query parameter
 */
async function validateWebSocketAuth(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  
  if (!token) {
    console.error("WebSocket token required");
    return new Response(JSON.stringify({ error: "WebSocket token required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  
  try {
    const symKey = await getSymKeyCached(request);
    if (!symKey) {
      console.error("Authentication not configured");
      return new Response(JSON.stringify({ error: "Authentication not configured" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const payload = await decryptToken(symKey, token);
    if (!payload || payload.exp <= Math.floor(Date.now() / 1000)) {
      console.error("Invalid or expired WebSocket token");
      return new Response(JSON.stringify({ error: "Invalid or expired WebSocket token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Token is valid
    return null;
  } catch (error) {
    console.error("WebSocket authentication error:", error);
    return new Response(JSON.stringify({ error: "WebSocket authentication failed" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Validates that request is a proper WebSocket upgrade request
 */
function validateWebSocketUpgrade(request: Request): Response | null {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response("Expected Upgrade: websocket", {
      status: 426,
    });
  }

  if (request.method !== "GET") {
    return new Response("Expected GET method", {
      status: 400,
    });
  }

  return null;
}


export default {
  async fetch(request: Request, _env: typeof worker.Env): Promise<Response> {
    const url = new URL(request.url);

    return asyncLocalStorage.run({ cf: request.cf }, async () => {
      // auth methods do not require auth - but browser/terminal HTML pages DO require auth
      // Only skip auth for WebSocket upgrades (ws protocol or /ws path with Upgrade header)
      const isWebSocketUpgrade = url.protocol.startsWith('ws') || 
                                (url.pathname.startsWith('/ws') && request.headers.get('Upgrade') === 'websocket') ||
                                ((url.pathname.startsWith('/src/terminal/') || url.pathname.startsWith('/src/browser/')) && request.headers.get('Upgrade') === 'websocket');
      
      const skipAuth = request.method === 'OPTIONS' || url.pathname.startsWith('/auth/') || isWebSocketUpgrade

      if (!skipAuth) {
        const authError = await requireAuth(request);
        if (authError) {
          return authError;
        }
      }

      // Handle WebSocket requests (terminal, browser, and RCON)
      const upgradeHeader = request.headers.get("Upgrade");
      const isWebSocketRequest = upgradeHeader === "websocket" && (
        url.protocol.startsWith('ws') || 
        url.pathname.startsWith('/ws') || 
        url.pathname.endsWith('/ws') ||
        (url.pathname.startsWith('/src/terminal/') && url.pathname.includes('/ws')) ||
        (url.pathname.startsWith('/src/browser/') && url.pathname.includes('/ws'))
      );
      
      if (isWebSocketRequest || (request.method === 'OPTIONS' && url.pathname.includes('/ws'))) {
        console.error('websocket request', request.url);
        return this.handleWebSocket(request, url.pathname);
      }

      if(request.method === 'OPTIONS') {
        try {
          console.error('options request', request.url);
          const response = await app.fetch(request);
          console.error('options response', response.headers);
          response.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin') || '*');
          response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
          response.headers.set('Access-Control-Allow-Credentials', 'true');
          response.headers.set('Access-Control-Max-Age', '86400');
          return response;
        } catch (error) {
          console.error('options error', error);
          return new Response(null, {
            status: 500,
            headers: {
              'Content-Type': 'text/plain',
            },
          });
        }
      }
      return app.fetch(request);
    });
  },

  async handleWebSocket(request: Request, pathname: string): Promise<Response> {

    if(getNodeEnv() === 'development' && request.method === 'OPTIONS') {
      // return cors preflight
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
        },
      });
    }
      
    // Validate WebSocket upgrade headers
    const upgradeError = validateWebSocketUpgrade(request);
    if (upgradeError) {
      console.error("WebSocket upgrade error:", upgradeError);
      return upgradeError;
    }

    // Validate authentication token
    const authError = await validateWebSocketAuth(request);
    if (authError) {
      console.error("WebSocket authentication error:", authError);
      return authError;
    }

    // Token is valid, route to appropriate WebSocket endpoint
    try {
      const container = getMinecraftContainer();
      
      if (pathname.startsWith('/src/browser/')) {
        console.error("Forwarding WebSocket to embedded browser (noVNC)");
        return container.fetch(request);
      } else if (pathname.startsWith('/src/terminal/')) {
        console.error("Forwarding WebSocket to ttyd");
        return container.fetch(request);
      } else {
        console.error("Forwarding WebSocket to RCON terminal");
        // Forward to RCON WebSocket handler
        return container.fetch(request);
      }
    } catch (error) {
      console.error("WebSocket connection error:", error);
      return new Response("WebSocket connection failed", { status: 503 });
    }
  }
};