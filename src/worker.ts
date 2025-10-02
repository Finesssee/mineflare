import { getContainer } from "@cloudflare/containers";
import { Elysia, t } from "elysia";
import type { worker } from "../alchemy.run";
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { MinecraftContainer } from "./container";
import { env as workerEnv } from 'cloudflare:workers'
import cors from "@elysiajs/cors";
import { getNodeEnv } from "./client/utils/node-env";

const env = workerEnv as typeof worker.Env;

function getMinecraftContainer() {
  return getContainer(env.MINECRAFT_CONTAINER as unknown as DurableObjectNamespace<MinecraftContainer>);
}

// Create Elysia app with proper typing for Cloudflare Workers
let elysiaApp = (
  getNodeEnv() === 'development'
  ? new Elysia({
      adapter: CloudflareAdapter,
      // aot: false,
    }).use(cors({
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        maxAge: 86400,
    }))
  : new Elysia({
      adapter: CloudflareAdapter,
      // aot: false,
    })
  )
  .get("/", () => 'foo')
  
  /**
   * Get the status of the Minecraft server. This always wakes the server and is the preferred way to wake the server. This may take up to 5 mins to return a value if the server is not already awake.
   */
  .get("/api/status", async () => {
    try {
      console.log("Getting container");
      const container = getMinecraftContainer();
      // This is the only endpoint that starts the container! But also it cannot be used if the container is shutting down.
      const state = await container.getState();
      if(state.status === "stopping") {
        return { online: false };
      }
      console.log("Starting container");
      await container.startAndWaitForPorts({
        cancellationOptions: {
          waitInterval: 250,
          instanceGetTimeoutMS: 2000,
          portReadyTimeoutMS: 300000
        }
      });
      const response = await container.fetch(new Request("http://localhost/rcon/status"));
      const status = await response.json();
      return status;
    } catch (error) {
      console.error("Failed to get status", error);
      return { online: false, error: "Failed to get status" };
    }
  })

  /**
   * Get the players of the Minecraft server. This may wake the server if not already awake.
   */
  .get("/api/players", async () => {
    try {
      const container = getMinecraftContainer();
      const response = await container.fetch(new Request("http://localhost/rcon/players"));
      const data = await response.json();
      return data;
    } catch (error) {
      return { players: [], error: "Failed to get players" };
    }
  })

  .get("/api/container/:id", async ({ params }: any) => {
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
  .get("/api/info", async () => {
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
  .get("/api/dynmap-url", () => {
    return { url: env.DYNMAP_WORKER_URL };
  })

  /**
   * Get the state of the container ("running" | "stopping" | "stopped" | "healthy" | "stopped_with_code"). This does not wake the container.
   */
  .get("/api/getState", async () => {
    const container = getMinecraftContainer();
    // lastChange: number
    // status: "running" | "stopping" | "stopped" | "healthy" | "stopped_with_code"
    const { lastChange, status } = await container.getState();
    return { lastChange, status };
  })

  /**
   * Get the plugin state. Works when container is stopped.
   */
  .get("/api/plugins", async () => {
    try {
      const container = getMinecraftContainer();
      const plugins = await container.getPluginState();
      return { plugins };
    } catch (error) {
      console.error("Failed to get plugin state:", error);
      return { plugins: [], error: "Failed to get plugin state" };
    }
  })

  /**
   * Enable or disable a plugin. Works when container is stopped.
   */
  .post("/api/plugins/:filename", async ({ params, body }: any) => {
    try {
      const container = getMinecraftContainer();
      const { filename } = params;
      const { enabled } = body as { enabled: boolean };
      
      if (enabled) {
        await container.enablePlugin({ filename });
      } else {
        await container.disablePlugin({ filename });
      }
      
      // Return updated plugin state
      const plugins = await container.getPluginState();
      return { success: true, plugins };
    } catch (error) {
      console.error("Failed to toggle plugin:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to toggle plugin" };
    }
  })
  
  .post("/api/shutdown", async () => {
    try {
      const container = getMinecraftContainer();
      await container.stop();
      container.getState();
      
      return { success: true };
    } catch (error) {
      console.error("Failed to shutdown container:", error);
      return { success: false, error: "Failed to shutdown container" };
    }
  })
  .compile()

export { MinecraftContainer } from "./container";

export default {
  fetch(request: Request, env: typeof worker.Env): Response | Promise<Response> {
    if(request.url.endsWith('/ws')) {
      return this.handleWebSocket(request, env);
    }
    return elysiaApp.fetch(request);
  },

  handleWebSocket(request: Request, env: typeof worker.Env): Response | Promise<Response> {
     // Expect to receive a WebSocket Upgrade request.
      // If there is one, accept the request and return a WebSocket Response.
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Worker expected Upgrade: websocket", {
          status: 426,
        });
      }

      if (request.method !== "GET") {
        return new Response("Worker expected GET method", {
          status: 400,
        });
      }
      
      let stub = getMinecraftContainer();

      return stub.fetch(request);
  }
};