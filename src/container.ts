import { Container, ContainerOptions } from "@cloudflare/containers";
import { worker } from "../alchemy.run";
import { DurableObject } from 'cloudflare:workers';
import { Rcon } from "./lib/rcon";
import { array, string } from "zod";

const StringArraySchema = array(string());
const DYNMAP_PLUGIN_FILENAME = 'Dynmap-3.7-beta-11-spigot';
export class MinecraftContainer extends Container<{
  TS_AUTHKEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  R2_BUCKET_NAME: string;
}> {

    private lastRconSuccess: Date | null = null;
    // Port the container listens on (default: 8080)
    defaultPort = 8080;
    // Time before container sleeps due to inactivity (default: 30s)
    sleepAfter = "20m";
    
    // Environment variables passed to the container
    envVars = {
        TS_EXTRA_ARGS: "--advertise-exit-node",
        TS_ENABLE_HEALTH_CHECK: "true",
        TS_LOCAL_ADDR_PORT: "0.0.0.0:8080",
        TS_AUTHKEY: this.env.TS_AUTHKEY,
        // Minecraft server configuration
        TYPE: "PAPER",
        EULA: "TRUE",
        SERVER_HOST: "0.0.0.0",
        ONLINE_MODE: "false",
        ENABLE_RCON: "true",
        // Hardcoded password is safe since we're running on a private tailnet
        RCON_PASSWORD: "minecraft",
        RCON_PORT: "25575",
        INIT_MEMORY: "2G",
        MAX_MEMORY: "4G",
        // R2 credentials for Dynmap S3 storage
        AWS_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY,
        AWS_ENDPOINT_URL: this.env.R2_ENDPOINT,
        DYNMAP_BUCKET: this.env.R2_BUCKET_NAME,
        OPTIONAL_PLUGINS: this.pluginFilenamesToEnable.join(" "), // space separated for consumption by bash script start-with-services.sh
    };
    
  
    enableInternet = true;
    private _container: DurableObject['ctx']['container'];
    private _sqlInitialized = false;
    private _initializeSql() {
      if(!this._sqlInitialized) {
        this._sqlInitialized = true;
        this.ctx.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS state (
            id    INTEGER PRIMARY KEY,
            json_data BLOB
          );
          INSERT OR IGNORE INTO state (id, json_data) VALUES (1, jsonb('{}'));
        `);
      }
      return this.ctx.storage.sql;
    }
    private get _sql() {
      return this._initializeSql();
    }

    constructor(ctx: DurableObject['ctx'], env: Env, options?: ContainerOptions) {
        super(ctx, env);
    
        if (ctx.container === undefined) {
          throw new Error(
            'Containers have not been enabled for this Durable Object class. Have you correctly setup your Wrangler config? More info: https://developers.cloudflare.com/containers/get-started/#configuration'
          );
        }
        this._container = ctx.container;
        // this._initializeSql();
    }

    private _pluginFilenamesToEnable: string[] | null = null;
    private get pluginFilenamesToEnable(): string[] {
      if(this._pluginFilenamesToEnable) {
        return this._pluginFilenamesToEnable;
      }
      // magic synchronous sql query
      try {
        const result = this._sql.exec("SELECT json(COALESCE(jsonb_extract(json_data, '$.optionalPlugins'), jsonb('[]'))) as optionalPlugins FROM state WHERE id = 1;").one();
        if(!result) {
          throw new Error("No result from sql query");
        }
        const parsed = StringArraySchema.parse(JSON.parse(result.optionalPlugins as string));
        // Always enable Dynmap
        if(!parsed.includes(DYNMAP_PLUGIN_FILENAME)) {
          parsed.unshift(DYNMAP_PLUGIN_FILENAME);
        }
        this._pluginFilenamesToEnable = parsed;
        return parsed;
      } catch (error) {
        console.error("Failed to get optional plugins:", error);
        return [];
      }
    }

    private set pluginFilenamesToEnable(plugins: string[]) {
      this._pluginFilenamesToEnable = plugins;
      const result = this._sql.exec(`
        UPDATE state 
        SET json_data = jsonb_patch(json_data, jsonb(?))
        WHERE id = 1
      `, JSON.stringify({ optionalPlugins: this.pluginFilenamesToEnable })).rowsWritten;
      console.log(result);
    }
        
    // RCON connection instance
    private rcon: Promise<Rcon> | null = null;

    // Optional lifecycle hooks
    override async start() {
      this._initializeSql();
      const newOptionalPlugins = this.pluginFilenamesToEnable.join(" ");
      if(newOptionalPlugins !== this.envVars.OPTIONAL_PLUGINS) {
        this.envVars.OPTIONAL_PLUGINS = this.pluginFilenamesToEnable.join(" ");
      }
      return super.start();
    }

    override onStart() {
      console.log("Container successfully started");
      this.ctx.waitUntil(this.initRcon().then(rcon => rcon?.send("dynmap fullrender world")));
    }
  
    override onStop() {
      console.log("Container successfully shut down");
      this.ctx.waitUntil(this.disconnectRcon());
    }
  
    override onError(error: unknown) {
      console.log("Container error:", error);
    }
  
    // Handle HTTP requests to this container
    override async fetch(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        console.log("Fetching container", url.pathname);

        console.log("Optional plugins", this.pluginFilenamesToEnable);
        
        if (url.pathname === '/ws') {
          console.log('websocket')
          // Creates two ends of a WebSocket connection.
          const webSocketPair = new WebSocketPair();
          const [client, server] = Object.values(webSocketPair);

          // Calling `acceptWebSocket()` connects the WebSocket to the Durable Object, allowing the WebSocket to send and receive messages.
          // Unlike `ws.accept()`, `state.acceptWebSocket(ws)` allows the Durable Object to be hibernated
          // When the Durable Object receives a message during Hibernation, it will run the `constructor` to be re-initialized
          console.log('accept websocket');
          this.ctx.acceptWebSocket(server);

          return new Response(null, {
            status: 101,
            webSocket: client,
          });
        }
        console.log('not websocket');

        // Handle RCON API requests
        if (url.pathname === "/rcon/status") {
          const status = await this.getRconStatus();
          return new Response(JSON.stringify(status), {
            headers: { "Content-Type": "application/json" }
          });
        }
        
        if (url.pathname === "/rcon/players") {
          const players = await this.getRconPlayers();
          return new Response(JSON.stringify({ players }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        
        if (url.pathname === "/rcon/info") {
          const info = await this.getRconInfo();
          return new Response(JSON.stringify(info), {
            headers: { "Content-Type": "application/json" }
          });
        }
    
        // Default health check
        if (url.pathname === "/healthz") {
          return new Response("OK");
        }
    
        return new Response("Not Found", { status: 404 });
      
      } catch (error) {
        console.error("Failed to fetch", error);
        return new Response("Internal Server Error", { status: 500 });
      }
    }
  
    // Initialize RCON connection
    private async initRcon(): Promise<Rcon | null> {
      if((await this.getState()).status === 'stopped' || (await this.getState()).status === 'stopping') {
        return null;
      }
      if(this.rcon) {
        console.log("RCON already initialized, checking if it's still valid");
        
        // We need to check if the connection is still valid and working
        const client = await this.rcon;
        if(this.lastRconSuccess?.getTime() ?? 0 < Date.now() - 10000) {
          if(await client.isConnected()) {
            this.lastRconSuccess = new Date();
            return client;
          } else {
            this.rcon = null;
            this.lastRconSuccess = null;
          }
        } else {
          return client;
        }
      }
      try {
        const port = this._container?.getTcpPort(25575);
        if(!port) {
          throw new Error("Failed to get RCON port");
        }
        
        console.log("Initializing RCON", Rcon);
        this.rcon = new Promise(async (resolve, reject) => {
          try {
            const rcon = new Rcon(port, "minecraft");
            await rcon.connect();
            console.log("RCON connected");
            this.lastRconSuccess = new Date();
            resolve(rcon);
          } catch (error) {
            this.rcon = null;
            reject(error);
          }
        });
        return this.rcon;
      } catch (error) {
        console.error("Failed to initialize RCON:", error);
        throw error;
      }
    }
  
    // Disconnect RCON
    private async disconnectRcon() {
      if (this.rcon) {
        const oldRcon = this.rcon;
        this.rcon = null;
        await oldRcon.then(rcon => rcon.disconnect());
      }
    }
  
    // Get server status via RCON
    private async getRconStatus(): Promise<{ online: boolean; playerCount?: number; maxPlayers?: number }> {
      if (!this.rcon) {
        if(!(await this.initRcon())) {
          return { online: false };
        } else {
          return { online: true };
        }
      }

      try {
        const listResponse = await this.rcon.then(rcon => rcon.send("list"));
        console.log("Received response from RCON", listResponse);
        
        // Parse response like "There are 3 of a max of 20 players online"
        const match = listResponse.match(/There are (\d+) of a max of (\d+) players online/);
        if (match) {
          return {
            online: true,
            playerCount: parseInt(match[1]),
            maxPlayers: parseInt(match[2])
          };
        } else {
          return { online: true };
        }
      } catch (error) {
        console.error("Failed to get server status:", error);
        return { online: false };
      }
    }
  
    // Get player list via RCON
    private async getRconPlayers(): Promise<string[]> {
      if (!this.rcon) {
        if(!(await this.initRcon())) {
          return [];
        }
      }

      try {
        const listResponse = await this.rcon!.then(rcon => rcon.send("list"));
        console.log("Received player list response from RCON", listResponse);
        
        // Parse player list from response
        const playerMatch = listResponse.match(/online: (.+)$/);
        if (playerMatch && playerMatch[1].trim() !== "") {
          const players = playerMatch[1].split(", ").map(p => p.trim());
          return players;
        } else {
          return [];
        }
      } catch (error) {
        console.error("Failed to get player list:", error);
        return [];
      }
    }
  
    // Get server info via RCON
    private async getRconInfo(): Promise<{ 
      serverType?: string;
      version?: string; 
      versionName?: string;
      versionId?: string;
      data?: string;
      series?: string;
      protocol?: string;
      buildTime?: string;
      packResource?: string;
      packData?: string;
      stable?: string;
      motd?: string;
    }> {
      if (!this.rcon) {
        if(!(await this.initRcon())) {
          return {};
        }
      }

      try {
        // Get version info via RCON. Handle weird / thing in vanilla MC
        const versionResponse = await this.rcon!.then(rcon => rcon.send("version")).then(r => r.split('/').join('\n/').trim());
        console.log("Received version response from RCON", versionResponse);
        
        const info: any = {
          motd: "Minecraft Server"
        };
        
        // Check if this is a Paper server format
        // Format: "§fThis server is running Paper version 1.21.7-32-main@e792779 (2025-07-16T20:10:15Z) (Implementing API version 1.21.7-R0.1-SNAPSHOT)§r"
        const paperMatch = versionResponse.match(/Paper version ([\d\.]+-\d+-[^@]+@[^\s]+)\s*\(([^)]+)\)\s*\(Implementing API version ([^)]+)\)/);
        
        if (paperMatch) {
          // Parse Paper format
          const [, version, buildTime, apiVersion] = paperMatch;
          
          info.serverType = "PaperMC";
          info.version = version;
          info.versionName = version;
          info.buildTime = buildTime;
          info.data = apiVersion;
          
          // Extract base version number (e.g., "1.21.7" from "1.21.7-32-main@e792779")
          const baseVersionMatch = version.match(/^([\d\.]+)/);
          if (baseVersionMatch) {
            info.versionId = baseVersionMatch[1];
          }
          
          console.log("Parsed Paper server version:", info);
        } else {
          // Parse default Minecraft format
          // Format: "Server version info:id = 1.21.9name = 1.21.9data = 4554..."
          // RCON doesn't include proper newlines, so we need to parse with regex
          
          info.serverType = "Minecraft Java";
          
          // Extract version fields using regex patterns
          const idMatch = versionResponse.match(/id\s*=\s*([^\s]+?)(?:name|$)/);
          const nameMatch = versionResponse.match(/name\s*=\s*([^\s]+?)(?:data|$)/);
          const dataMatch = versionResponse.match(/data\s*=\s*([^\s]+?)(?:series|$)/);
          const seriesMatch = versionResponse.match(/series\s*=\s*([^\s]+?)(?:protocol|$)/);
          const protocolMatch = versionResponse.match(/protocol\s*=\s*([^\s]+?)\s*\([^)]+\)(?:build_time|$)/);
          const buildTimeMatch = versionResponse.match(/build_time\s*=\s*(.+?)(?:pack_resource|$)/);
          const packResourceMatch = versionResponse.match(/pack_resource\s*=\s*([^\s]+?)(?:pack_data|$)/);
          const packDataMatch = versionResponse.match(/pack_data\s*=\s*([^\s]+?)(?:stable|$)/);
          const stableMatch = versionResponse.match(/stable\s*=\s*([^\s]+?)$/);
          
          if (idMatch) info.versionId = idMatch[1].trim();
          if (nameMatch) info.versionName = nameMatch[1].trim();
          if (dataMatch) info.data = dataMatch[1].trim();
          if (seriesMatch) info.series = seriesMatch[1].trim();
          if (protocolMatch) info.protocol = protocolMatch[1].trim();
          if (buildTimeMatch) info.buildTime = buildTimeMatch[1].trim();
          if (packResourceMatch) info.packResource = packResourceMatch[1].trim();
          if (packDataMatch) info.packData = packDataMatch[1].trim();
          if (stableMatch) info.stable = stableMatch[1].trim();
          
          // Set the main version field to the version name
          info.version = info.versionName || "Unknown";
          
          console.log("Parsed default Minecraft server version:", info);
        }
        
        return info;
      } catch (error) {
        console.error("Failed to get server info:", error);
        return { version: "Unknown", motd: "Minecraft Server" };
      }
    }

    public async listAllPlugins() {
      return [{
        displayName: 'DynMap',
        filename: DYNMAP_PLUGIN_FILENAME,
      },
      {
        displayName: 'playit.gg',
        filename: 'playit-minecraft-plugin',
      }] as const;
    }

    // Async because it's easier to consume as RPC if fn is async
    public async enablePlugin({ filename }: { filename: string }) {
      this.pluginFilenamesToEnable = [...this.pluginFilenamesToEnable, filename];
    }

    // Async because it's easier to consume as RPC if fn is async
    public async disablePlugin({ filename }: { filename: string }) {
      if(filename === DYNMAP_PLUGIN_FILENAME) {
        throw new Error("Dynmap cannot be disabled");
      }
      this.pluginFilenamesToEnable = this.pluginFilenamesToEnable.filter(p => p !== filename);
    }


    public async getPluginState(): Promise<Array<{filename: string, displayName: string, state: 'ENABLED' | 'DISABLED_WILL_ENABLE_AFTER_RESTART' | 'ENABLED_WILL_DISABLE_AFTER_RESTART' | 'DISABLED'}>> {
      const enabledPlugins = this.envVars.OPTIONAL_PLUGINS.split(" ");
      const desiredPlugins = await this.pluginFilenamesToEnable;
      const allPlugins = await this.listAllPlugins();
      return allPlugins.map(plugin => ({
        filename: plugin.filename,
        displayName: plugin.displayName,
        state: desiredPlugins.includes(plugin.filename) ? (enabledPlugins.includes(plugin.filename) ? 'ENABLED' : 'DISABLED_WILL_ENABLE_AFTER_RESTART') : (enabledPlugins.includes(plugin.filename) ? 'ENABLED_WILL_DISABLE_AFTER_RESTART' : 'DISABLED'),
      }));
    }

    async broadcast(message: ArrayBuffer | string) {
      for (const ws of this.ctx.getWebSockets()) {
        ws.send(message);
      }
    }

    async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
      // Upon receiving a message from the client, reply with the same message,
      // but will prefix the message with "[Durable Object]: " and return the number of connections.
      if(!this.rcon && !(await this.initRcon())) {
        ws.send("Message delivery failed: Server is offline");
        return;
      }
      
      const messageString = message instanceof ArrayBuffer ? new TextDecoder().decode(message) : message;
      // const [command, ...args] = messageString.split(" ");
      
      const response = await this.rcon!.then(rcon => rcon.send(messageString));

      ws.send(response);
    }

    async webSocketClose(
      ws: WebSocket,
      code: number,
      reason: string,
      wasClean: boolean,
    ) {
      // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
      ws.close(code, "Durable Object is closing WebSocket");
    }
}
