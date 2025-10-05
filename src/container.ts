import { Container, ContainerOptions } from "@cloudflare/containers";
import { worker } from "../alchemy.run";
import { DurableObject } from 'cloudflare:workers';
import { Rcon } from "./lib/rcon";
import { array, string } from "zod";

const StringArraySchema = array(string());
const DYNMAP_PLUGIN_FILENAME = 'Dynmap-3.7-beta-11-spigot';

// Plugin status types
type PluginStatus = 
  | { type: "no message" }
  | { type: "information"; message: string }
  | { type: "warning"; message: string }
  | { type: "alert"; message: string };

// Plugin specifications with required environment variables
const PLUGIN_SPECS = [
  {
    filename: 'Dynmap-3.7-beta-11-spigot',
    displayName: 'DynMap',
    requiredEnv: [] as Array<{ name: string; description: string }>,
    getStatus: async (container: MinecraftContainer): Promise<PluginStatus> => {
      return { type: "information", message: "Map rendering is active" };
    },
  },
  {
    filename: 'playit-minecraft-plugin',
    displayName: 'playit.gg',
    requiredEnv: [] as Array<{ name: string; description: string }>,
    getStatus: async (container: MinecraftContainer): Promise<PluginStatus> => {

      // need to check if we find any matching url https://playit.gg/mc/<code>" using regex
      const logs = await container.getLogs();
      const regex = /https:\/\/playit\.gg\/mc\/([a-f0-9]+)/gi;
      const matches = [...logs.matchAll(regex)];
      // get last match if any exist
      if(matches && matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const code = lastMatch[1];
        return { type: "warning", message: "not connected go to https://playit.gg/mc/" + code + " to connect" };
      } else {
        return { type: "information", message: "playit.gg is active" };
      }
    },
  },
] as const;

export class MinecraftContainer extends Container<{
  TS_AUTHKEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  R2_BUCKET_NAME: string;
}> {

    private lastRconSuccess: Date | null = null;
    private _isPasswordSet: boolean = false;
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
          CREATE TABLE IF NOT EXISTS auth (
            id INTEGER PRIMARY KEY,
            salt TEXT,
            password_hash TEXT,
            sym_key TEXT,
            created_at INTEGER
          );
        `);
      }
      return this.ctx.storage.sql;
    }
    private get _sql() {
      return this._initializeSql();
    }

    constructor(ctx: DurableObject['ctx'], env: Env, options?: ContainerOptions) {
        super(ctx, env);
        console.error("constructor");
        if (ctx.container === undefined) {
          throw new Error(
            'Containers have not been enabled for this Durable Object class. Have you correctly setup your Wrangler config? More info: https://developers.cloudflare.com/containers/get-started/#configuration'
          );
        }
        this._container = ctx.container;
        // Initialize SQL immediately so we can synchronously determine password status
        this._initializeSql();
        try {
          const result = this._sql.exec("SELECT 1 as ok FROM auth LIMIT 1;").one();
          this._isPasswordSet = result?.ok === 1;
        } catch (_) {
          this._isPasswordSet = false;
        }
    }

    // Public async method for RPC
    public async isPasswordSet(): Promise<boolean> {
      return this._isPasswordSet;
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

    // Get configured environment variables for a specific plugin
    private getConfiguredPluginEnv(filename: string): Record<string, string> {
      try {
        const result = this._sql.exec(
          `SELECT json(COALESCE(jsonb_extract(json_data, '$.pluginEnv."' || ? || '"'), jsonb('{}'))) as env FROM state WHERE id = 1;`,
          filename
        ).one();
        if (!result) {
          return {};
        }
        return JSON.parse(result.env as string);
      } catch (error) {
        console.error("Failed to get configured plugin env:", error);
        return {};
      }
    }

    // Set configured environment variables for a specific plugin
    private setConfiguredPluginEnv(filename: string, env: Record<string, string>): void {
      this.ctx.storage.transactionSync(() => {
        // Read current env for this plugin
        const current = this.getConfiguredPluginEnv(filename);
        // Merge with new values (filter out undefined/null)
        const next: Record<string, string> = { ...current };
        for (const [key, value] of Object.entries(env)) {
          if (value !== undefined && value !== null) {
            next[key] = value;
          }
        }
        // Write merged object
        this._sql.exec(
          `UPDATE state SET json_data = jsonb_patch(json_data, jsonb(?)) WHERE id = 1`,
          JSON.stringify({ pluginEnv: { [filename]: next } })
        );
      });
    }

    // Get all configured plugin environment variables
    private getAllConfiguredPluginEnv(): Record<string, Record<string, string>> {
      try {
        const result = this._sql.exec(
          `SELECT json(COALESCE(jsonb_extract(json_data, '$.pluginEnv'), jsonb('{}'))) as pluginEnv FROM state WHERE id = 1;`
        ).one();
        console.error("pluginEnv result", result);
        if (!result) {
          return {};
        }
        return JSON.parse(result.pluginEnv as string);
      } catch (error) {
        console.error("Failed to get all configured plugin env:", error);
        return {};
      }
    }

    // Get required env vars for a plugin from specs
    private getRequiredEnvForPlugin(filename: string): Array<{ name: string; description: string }> {
      const spec = PLUGIN_SPECS.find(s => s.filename === filename);
      return spec ? [...spec.requiredEnv] : [];
    }
        
    // RCON connection instance
    private rcon: Promise<Rcon> | null = null;

    // Optional lifecycle hooks
    override async start() {
      console.error("start");
      this._initializeSql();
      const newOptionalPlugins = this.pluginFilenamesToEnable.join(" ");
      if(newOptionalPlugins !== this.envVars.OPTIONAL_PLUGINS) {
        this.envVars.OPTIONAL_PLUGINS = this.pluginFilenamesToEnable.join(" ");
      }
      
      // Inject configured plugin environment variables (only mutate envVars here!)
      const allPluginEnv = this.getAllConfiguredPluginEnv();
      console.error("allPluginEnv", allPluginEnv);
      for (const [pluginFilename, envVars] of Object.entries(allPluginEnv)) {
        console.error("pluginFilename", pluginFilename);
        console.error("envVars", envVars);
        for (const [key, value] of Object.entries(envVars)) {
          // Only set if not already defined (core worker env wins)
          if (this.envVars[key as keyof typeof this.envVars] !== value) {
            console.error("Setting env var", key, value);
            (this.envVars as any)[key] = value;
          }
        }
      }

      if(await this.getStatus() !== 'stopped') {
        // wait up to 3 mins for the server to start
        while(await this.getStatus() !== 'running') {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if(await this.getStatus() !== 'running') {
          throw new Error("Server did not start in time");
        }
      }
      
      return super.startAndWaitForPorts(8080, {
          waitInterval: 250,
          instanceGetTimeoutMS: 2000,
          portReadyTimeoutMS: 300000
      });
    }

    override onStart() {
      console.log("Container successfully started");
      this.ctx.waitUntil(this.initRcon().then(rcon => rcon?.send("dynmap fullrender world")));
    }
  
  // =====================
  // Authentication helpers & methods
  // =====================

  private base64urlEncode(data: ArrayBuffer | Uint8Array): string {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    // btoa is available in Workers
    const b64 = btoa(str);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private base64urlDecode(input: string): Uint8Array {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
    const str = atob(b64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    return bytes;
  }

  private async derivePasswordHash(password: string, saltB64: string): Promise<string> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const saltBytes = this.base64urlDecode(saltB64);
    const saltBuf = new Uint8Array(saltBytes).buffer as ArrayBuffer;
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: saltBuf }, keyMaterial, 256);
    return this.base64urlEncode(bits);
  }

  private generateRandomBytes(length: number): Uint8Array {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return arr;
  }

  // Async because it's easier to consume as RPC if fn is async
  public async setupPassword({ password }: { password: string }): Promise<{ created: boolean; symKey?: string }>{
    const run = async () => {
      console.log("setupPassword: Starting, isPasswordSet =", this._isPasswordSet);
      
      // Pre-generate values outside of transaction
      const salt = this.generateRandomBytes(16);
      const saltB64 = this.base64urlEncode(salt);
      const symKeyBytes = this.generateRandomBytes(32);
      const symKeyB64 = this.base64urlEncode(symKeyBytes);
      const hash = await this.derivePasswordHash(password, saltB64);

      console.log("setupPassword: Pre-generated values ready, entering transaction");
      
      // Use Cloudflare's transactionSync API for atomic operations
      const result = this.ctx.storage.transactionSync(() => {
        const checkResult = this._sql.exec('SELECT 1 as ok FROM auth LIMIT 1;');
        console.log("setupPassword: Transaction check, rowsRead =", checkResult.rowsRead);
        try {
          if(checkResult.one().ok) {
            console.log("setupPassword: Password already exists, aborting");
            return { created: false } as const;
          }
        } catch (_) {
          // Password doesn't exist
        }

        console.log("setupPassword: No existing password, inserting new auth record");
        const insertResult = this._sql.exec(
          'INSERT INTO auth (id, salt, password_hash, sym_key, created_at) VALUES (1, ?, ?, ?, ?);',
          saltB64, hash, symKeyB64, Date.now()
        );
        console.log("setupPassword: Insert result, rowsWritten =", insertResult.rowsWritten);

        this._isPasswordSet = true;
        return { created: true, symKey: symKeyB64 } as const;
      });
      
      console.log("setupPassword: Transaction complete, result =", result);
      return result;
    };

    // Prefer blocking concurrency if available
    const anyCtx: any = this.ctx as any;
    if (anyCtx && typeof anyCtx.blockConcurrencyWhile === 'function') {
      console.log("setupPassword: Using blockConcurrencyWhile");
      return await anyCtx.blockConcurrencyWhile(run);
    }
    console.log("setupPassword: No blockConcurrencyWhile, running directly");
    return await run();
  }

  public async getLogs(): Promise<string> {
    const response = await this.containerFetch("http://localhost:8082/", 8082);
    return await response.text();
  }

  public async getFileContents(filePath: string): Promise<string> {
    // Ensure the path starts with /
    const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;
    
    try {
      const response = await this.containerFetch(`http://localhost:8083${normalizedPath}`, 8083);
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`File not found: ${filePath}`);
        } else if (response.status === 500) {
          const errorText = await response.text();
          throw new Error(`Permission error or internal error: ${errorText}`);
        } else {
          throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
        }
      }
      
      return await response.text();
    } catch (error) {
      console.error("Failed to get file contents:", error);
      throw error;
    }
  }

  private async getStatus(): Promise<'running' | 'stopping' | 'stopped' | 'starting'> {
    const state = (await this.getState()).status;
    if(state === 'stopped_with_code') {
      return 'stopped';
    } else if ( state === 'healthy') {
      return 'running';
    } else {
      return state;
    }
  }

  // Async because it's easier to consume as RPC if fn is async
  public async verifyPassword({ password }: { password: string }): Promise<{ ok: boolean }>{
    try {
      const row = this._sql.exec('SELECT salt, password_hash FROM auth LIMIT 1;').one();
      if (!row) {
        return { ok: false };
      }
      const salt = (row.salt as string) ?? '';
      const storedHash = (row.password_hash as string) ?? '';
      const derived = await this.derivePasswordHash(password, salt);
      return { ok: this.timingSafeEqualAscii(derived, storedHash) };
    } catch (_) {
      return { ok: false };
    }
  }

  private timingSafeEqualAscii(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
      mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
  }

  // Async because it's easier to consume as RPC if fn is async
  public async getSymmetricKey(): Promise<{ symKey?: string }>{
    if (!this._isPasswordSet) return {};
    try {
      const row = this._sql.exec('SELECT sym_key FROM auth LIMIT 1;').one();
      if (!row) return {};
      return { symKey: row.sym_key as string };
    } catch (_) {
      return {};
    }
  }

  // Debug helper - clear auth (dev only)
  public async clearAuth(): Promise<void> {
    console.log("clearAuth: Clearing auth table");
    this.ctx.storage.transactionSync(() => {
      this._sql.exec('DELETE FROM auth;');
      this._isPasswordSet = false;
    });
    console.log("clearAuth: Complete, isPasswordSet =", this._isPasswordSet);
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
        
        if (url.protocol.startsWith('ws') || url.pathname.startsWith('/ws')) {
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
            const rcon = new Rcon(port, "minecraft", () => this.getStatus());
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
      return PLUGIN_SPECS.map(spec => ({
        displayName: spec.displayName,
        filename: spec.filename,
        requiredEnv: [...spec.requiredEnv], // Clone to mutable array
      }));
    }

    // Async because it's easier to consume as RPC if fn is async
    public async enablePlugin({ filename, env }: { filename: string; env?: Record<string, string> }) {
      // If env provided, persist it first
      if (env) {
        this.setConfiguredPluginEnv(filename, env);
      }
      
      // Validate that all required env vars are set
      const requiredEnv = this.getRequiredEnvForPlugin(filename);
      if (requiredEnv.length > 0) {
        const configured = this.getConfiguredPluginEnv(filename);
        const missing = requiredEnv.filter(({ name }) => !configured[name] || configured[name].trim() === '');
        
        if (missing.length > 0) {
          const missingNames = missing.map(e => e.name).join(', ');
          throw new Error(`Cannot enable plugin ${filename}: missing required environment variables: ${missingNames}`);
        }
      }
      
      this.pluginFilenamesToEnable = [...this.pluginFilenamesToEnable, filename];
    }

    // Async because it's easier to consume as RPC if fn is async
    public async disablePlugin({ filename }: { filename: string }) {
      if(filename === DYNMAP_PLUGIN_FILENAME) {
        throw new Error("Dynmap cannot be disabled");
      }
      this.pluginFilenamesToEnable = this.pluginFilenamesToEnable.filter(p => p !== filename);
    }

    // Async because it's easier to consume as RPC if fn is async
    public async setPluginEnv({ filename, env }: { filename: string; env: Record<string, string> }) {
      this.setConfiguredPluginEnv(filename, env);
    }


    public async getPluginState(): Promise<Array<{
      filename: string;
      displayName: string;
      state: 'ENABLED' | 'DISABLED_WILL_ENABLE_AFTER_RESTART' | 'ENABLED_WILL_DISABLE_AFTER_RESTART' | 'DISABLED';
      requiredEnv: Array<{ name: string; description: string }>;
      configuredEnv: Record<string, string>;
      status: PluginStatus;
    }>> {
      const enabledPlugins = this.envVars.OPTIONAL_PLUGINS.split(" ");
      const desiredPlugins = await this.pluginFilenamesToEnable;
      const allPlugins = await this.listAllPlugins();
      
      // Resolve all plugin statuses in parallel
      const pluginsWithStatus = await Promise.all(
        allPlugins.map(async (plugin) => {
          const spec = PLUGIN_SPECS.find(s => s.filename === plugin.filename);
          
          // Only check status for plugins that are currently enabled in envVars
          const isCurrentlyEnabled = enabledPlugins.includes(plugin.filename);
          const status = (spec?.getStatus && isCurrentlyEnabled)
            ? await spec.getStatus(this).catch(() => ({ type: "no message" as const }))
            : { type: "no message" as const };
          
          const state: 'ENABLED' | 'DISABLED_WILL_ENABLE_AFTER_RESTART' | 'ENABLED_WILL_DISABLE_AFTER_RESTART' | 'DISABLED' = 
            desiredPlugins.includes(plugin.filename) 
              ? (enabledPlugins.includes(plugin.filename) ? 'ENABLED' : 'DISABLED_WILL_ENABLE_AFTER_RESTART') 
              : (enabledPlugins.includes(plugin.filename) ? 'ENABLED_WILL_DISABLE_AFTER_RESTART' : 'DISABLED');
          
          return {
            filename: plugin.filename,
            displayName: plugin.displayName,
            state,
            requiredEnv: plugin.requiredEnv,
            configuredEnv: this.getConfiguredPluginEnv(plugin.filename),
            status,
          };
        })
      );
      
      return pluginsWithStatus;
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
