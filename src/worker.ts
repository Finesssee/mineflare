import { Elysia, t } from "elysia";
import type { worker } from "../alchemy.run";
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { env as workerEnv } from 'cloudflare:workers'
import cors from "@elysiajs/cors";
import { getNodeEnv } from "./client/utils/node-env";
import { getMinecraftContainer } from "./server/get-minecraft-container";
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
  .get("/logs", async () => {
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
  .get("/status", async () => {
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
  .get("/players", async () => {
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
  .get("/info", async () => {
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
  .get("/getState", async () => {
    const container = getMinecraftContainer();
    // lastChange: number
    // status: "running" | "stopping" | "stopped" | "healthy" | "stopped_with_code"
    const { lastChange } = await container.getState();
    const status = await container.getStatus();
    return { lastChange, status };
  })

  /**
   * Get the plugin state. Works when container is stopped.
   */
  .get("/plugins", async () => {
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
  .post("/plugins/:filename", async ({ params, body }: any) => {
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
   * Execute an RCON command on the Minecraft server
   */
  .post("/rcon/execute", async ({ body }: any) => {
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
  
  .post("/shutdown", async () => {
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
  .get("/session/current", async () => {
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
  .get("/session/last", async () => {
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
  .get("/session/stats", async () => {
    try {
      const container = getMinecraftContainer();
      const stats = await container.getUsageStats();
      return stats;
    } catch (error) {
      console.error("Failed to get usage stats:", error);
      return { thisMonth: 0, thisYear: 0, error: "Failed to get usage stats" };
    }
  })
  .get("/startup-status", async () => {
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

    // auth methods do not require auth
    const skipAuth = request.method === 'OPTIONS' || url.pathname.startsWith('/auth/') || url.protocol.startsWith('ws') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/src/terminal/')

    if (!skipAuth) {
      const authError = await requireAuth(request);
      if (authError) {
        return authError;
      }
    }

    // Handle WebSocket requests (both terminal and RCON)
    if (url.protocol.startsWith('ws') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/src/terminal/')) {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader === "websocket" || request.method === 'OPTIONS') {
        return this.handleWebSocket(request, url.pathname);
      }
      
      return new Response("Expected Upgrade: websocket", {
        status: 426,
      });
      
    }

    return app.fetch(request);
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
      return upgradeError;
    }

    // Validate authentication token
    const authError = await validateWebSocketAuth(request);
    if (authError) {
      return authError;
    }

    // Token is valid, route to appropriate WebSocket endpoint
    try {
      const container = getMinecraftContainer();
      
      if (pathname === '/src/terminal/ws') {
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