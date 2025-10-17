import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOAuthMetadata, validateMcpBearerToken } from "./server/mcp-oauth";
import type { agentWorker } from "../alchemy.run";
import { WorkerEntrypoint } from "cloudflare:workers";
import { readFileSync } from "fs";

export class MineflareAgent extends McpAgent {
    server = new McpServer({ 
        name: "mineflare", 
        version: "1.0.0",
        description: "Manage your Minecraft server"
    });

    async init() {
        // Load component HTML templates
        const loadComponent = (name: string) => {
            try {
                return readFileSync(`src/mcp-components/dist/${name}.html`, 'utf8');
            } catch (error) {
                console.error(`Failed to load component ${name}:`, error);
                return `<div>Component ${name} not found</div>`;
            }
        };

        // Register component resources
        this.server.registerResource(
            "server-overview",
            "ui://widget/server-overview.html",
            {},
            async () => ({
                contents: [{
                    uri: "ui://widget/server-overview.html",
                    mimeType: "text/html+skybridge",
                    text: loadComponent('server-overview'),
                    _meta: {
                        "openai/widgetDescription": "Shows comprehensive server status including online/offline state, player count, session duration, and quick action buttons.",
                        "openai/widgetPrefersBorder": true,
                    }
                }]
            })
        );

        this.server.registerResource(
            "dynmap",
            "ui://widget/dynmap.html",
            {},
            async () => ({
                contents: [{
                    uri: "ui://widget/dynmap.html",
                    mimeType: "text/html+skybridge",
                    text: loadComponent('dynmap'),
                    _meta: {
                        "openai/widgetDescription": "Displays an interactive fullscreen map of the Minecraft world with player locations and terrain.",
                        "openai/widgetPrefersBorder": false,
                    }
                }]
            })
        );

        this.server.registerResource(
            "server-action",
            "ui://widget/server-action.html",
            {},
            async () => ({
                contents: [{
                    uri: "ui://widget/server-action.html",
                    mimeType: "text/html+skybridge",
                    text: loadComponent('server-action'),
                    _meta: {
                        "openai/widgetDescription": "Shows the progress and result of server start/stop operations with status updates.",
                        "openai/widgetPrefersBorder": true,
                    }
                }]
            })
        );

        this.server.registerResource(
            "terminal",
            "ui://widget/terminal.html",
            {},
            async () => ({
                contents: [{
                    uri: "ui://widget/terminal.html",
                    mimeType: "text/html+skybridge",
                    text: loadComponent('terminal'),
                    _meta: {
                        "openai/widgetDescription": "Provides a fullscreen terminal interface for direct server access and plugin development with Claude assistance.",
                        "openai/widgetPrefersBorder": false,
                    }
                }]
            })
        );

        this.server.registerResource(
            "rcon-output",
            "ui://widget/rcon-output.html",
            {},
            async () => ({
                contents: [{
                    uri: "ui://widget/rcon-output.html",
                        mimeType: "text/html+skybridge",
                    text: loadComponent('rcon-output'),
                    _meta: {
                        "openai/widgetDescription": "Displays the output of executed RCON commands with syntax highlighting and quick command suggestions.",
                        "openai/widgetPrefersBorder": true,
                    }
                }]
            })
        );

        // Helper to make API calls to the main worker
        const callWorkerAPI = async (path: string, options?: RequestInit): Promise<any> => {
            const baseUrl = (this.env as any).WORKER_URL || 'http://localhost';
            const response = await fetch(`${baseUrl}${path}`, options);
            return response.json();
        };

        // Register tools
        
        // 1. get_server_overview - Shows comprehensive status
        this.server.registerTool(
            "get_server_overview",
            {
                title: "Get Server Overview",
                description: "Use when the user asks about their server status, who's online, or how the server is doing. Shows comprehensive status including online players and session info.",
                inputSchema: {},
                annotations: {
                    readOnlyHint: true
                },
                _meta: {
                    "openai/outputTemplate": "ui://widget/server-overview.html",
                    "openai/toolInvocation/invoking": "Checking your server...",
                    "openai/toolInvocation/invoked": "Server status retrieved"
                }
            },
            async () => {
                try {
                    // Fetch data from multiple endpoints in parallel
                    const [status, playersData, state, session] = await Promise.all([
                        callWorkerAPI('/api/status'),
                        callWorkerAPI('/api/players'),
                        callWorkerAPI('/api/getState'),
                        callWorkerAPI('/api/session/current')
                    ]);

                    const players = playersData.players || [];
                    const structuredData = {
                        status: {
                            online: status.online || false,
                            playerCount: status.playerCount ?? 0,
                            maxPlayers: status.maxPlayers ?? 20
                        },
                        players: players.map((name: string) => ({ name, uuid: `player-${name}` })),
                        serverState: state.status || 'stopped',
                        startupStep: status.startupStep,
                        sessionInfo: session
                    };

                    return {
                        content: [{
                            type: "text",
                            text: `Server is ${status.online ? 'online' : 'offline'}. ${players.length} player${players.length !== 1 ? 's' : ''} online.`
                        }],
                        structuredContent: structuredData
                    };
                } catch (error) {
                    console.error("Failed to get server overview:", error);
                    return {
                        content: [{ type: "text", text: "Failed to retrieve server status." }],
                        structuredContent: {
                            status: { online: false },
                            players: [],
                            serverState: 'stopped'
                        }
                    };
                }
            }
        );

        // 2. view_dynmap - Shows world map
        this.server.registerTool(
            "view_dynmap",
            {
                title: "View Dynmap",
                description: "Use when the user wants to see their Minecraft world map, check player locations, or view the terrain. Opens an interactive map in fullscreen.",
                inputSchema: {},
                annotations: {
                    readOnlyHint: true
                },
                _meta: {
                    "openai/outputTemplate": "ui://widget/dynmap.html",
                    "openai/toolInvocation/invoking": "Loading your world map...",
                    "openai/toolInvocation/invoked": "Map loaded"
                }
            },
            async () => {
                try {
                    const dynmapData = await callWorkerAPI('/api/dynmap-url');
                    const plugins = await callWorkerAPI('/api/plugins');
                    
                    // Check if Dynmap is enabled
                    const dynmapPlugin = plugins.plugins?.find((p: any) => 
                        p.filename.includes('Dynmap') && 
                        (p.state === 'ENABLED' || p.state === 'DISABLED_WILL_ENABLE_AFTER_RESTART')
                    );

                    return {
                        content: [{
                            type: "text",
                            text: dynmapPlugin ? "Here's your Minecraft world map!" : "Dynmap is not enabled. Enable it to view the map."
                        }],
                        structuredContent: {
                            dynmapUrl: dynmapData.url || '',
                            mapEnabled: !!dynmapPlugin
                        }
                    };
                } catch (error) {
                    console.error("Failed to get dynmap URL:", error);
                    return {
                        content: [{ type: "text", text: "Failed to load map." }],
                        structuredContent: {
                            dynmapUrl: '',
                            mapEnabled: false
                        }
                    };
                }
            }
        );

        // 3. start_minecraft_server - Starts the server
        this.server.registerTool(
            "start_minecraft_server",
            {
                title: "Start Minecraft Server",
                description: "Use when the user wants to start or launch their Minecraft server. Requires confirmation and shows startup progress.",
                inputSchema: {},
                annotations: {
                    readOnlyHint: false
                },
                _meta: {
                    "openai/outputTemplate": "ui://widget/server-action.html",
                    "openai/toolInvocation/invoking": "Starting your server...",
                    "openai/toolInvocation/invoked": "Server started"
                }
            },
            async () => {
                try {
                    // Check current state
                    const state = await callWorkerAPI('/api/getState');
                    
                    if (state.status === 'running') {
                        return {
                            content: [{ type: "text", text: "Server is already running!" }],
                            structuredContent: {
                                success: true,
                                serverState: 'running',
                                message: 'Server is already online',
                                action: 'start'
                            }
                        };
                    }

                    if (state.status === 'starting') {
                        return {
                            content: [{ type: "text", text: "Server is already starting up..." }],
                            structuredContent: {
                                success: true,
                                serverState: 'starting',
                                message: 'Server startup in progress',
                                action: 'start'
                            }
                        };
                    }

                    // Trigger start by calling status endpoint
                    await callWorkerAPI('/api/status');

                    return {
                        content: [{ type: "text", text: "Server is starting up! This may take up to 5 minutes." }],
                        structuredContent: {
                            success: true,
                            serverState: 'starting',
                            message: 'Server startup initiated',
                            action: 'start'
                        }
                    };
                } catch (error) {
                    console.error("Failed to start server:", error);
                    return {
                        content: [{ type: "text", text: "Failed to start server." }],
                        structuredContent: {
                            success: false,
                            serverState: 'stopped',
                            message: 'Failed to initiate startup',
                            action: 'start'
                        }
                    };
                }
            }
        );

        // 4. stop_minecraft_server - Stops the server
        this.server.registerTool(
            "stop_minecraft_server",
            {
                title: "Stop Minecraft Server",
                description: "Use when the user wants to stop, shut down, or turn off their server. Requires confirmation and performs automatic world backup.",
                inputSchema: {},
                annotations: {
                    readOnlyHint: false
                },
                _meta: {
                    "openai/outputTemplate": "ui://widget/server-action.html",
                    "openai/toolInvocation/invoking": "Stopping server and backing up world...",
                    "openai/toolInvocation/invoked": "Server stopped safely"
                }
            },
            async () => {
                try {
                    const state = await callWorkerAPI('/api/getState');
                    
                    if (state.status === 'stopped') {
                        return {
                            content: [{ type: "text", text: "Server is already stopped." }],
                            structuredContent: {
                                success: true,
                                serverState: 'stopped',
                                message: 'Server is already offline',
                                action: 'stop'
                            }
                        };
                    }

                    // Call shutdown endpoint
                    const result = await callWorkerAPI('/api/shutdown', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    return {
                        content: [{ type: "text", text: "Server stopped successfully. World data backed up safely." }],
                        structuredContent: {
                            success: result.success,
                            serverState: 'stopped',
                            message: 'Server shut down and backed up',
                            lastSession: result.lastSession,
                            action: 'stop'
                        }
                    };
                } catch (error) {
                    console.error("Failed to stop server:", error);
                    return {
                        content: [{ type: "text", text: "Failed to stop server." }],
                        structuredContent: {
                            success: false,
                            serverState: 'running',
                            message: 'Failed to shut down server',
                            action: 'stop'
                        }
                    };
                }
            }
        );

        // 5. open_terminal - Opens terminal interface
        this.server.registerTool(
            "open_terminal",
            {
                title: "Open Terminal",
                description: "Use when the user wants to access the server terminal, create plugins with Claude, or run shell commands. Opens a fullscreen terminal interface.",
                inputSchema: {},
                annotations: {
                    readOnlyHint: true
                },
                _meta: {
                    "openai/outputTemplate": "ui://widget/terminal.html",
                    "openai/toolInvocation/invoking": "Opening terminal...",
                    "openai/toolInvocation/invoked": "Terminal ready",
                    "openai/widgetAccessible": true
                }
            },
            async () => {
                try {
                    // Get WebSocket token
                    const tokenResponse = await callWorkerAPI('/auth/ws-token');
                    const state = await callWorkerAPI('/api/getState');
                    
                    const baseUrl = (this.env as any).WORKER_URL || '';
                    const terminalUrl = `${baseUrl}/src/terminal`;

                    return {
                        content: [{ type: "text", text: "Terminal opened. You can now run commands and create plugins with my help!" }],
                        structuredContent: {
                            terminalUrl,
                            wsToken: tokenResponse.token,
                            serverRunning: state.status === 'running'
                        }
                    };
                } catch (error) {
                    console.error("Failed to open terminal:", error);
                    return {
                        content: [{ type: "text", text: "Failed to open terminal." }],
                        structuredContent: {
                            terminalUrl: '',
                            wsToken: '',
                            serverRunning: false
                        }
                    };
                }
            }
        );

        // 6. execute_rcon_command - Runs RCON commands
        this.server.registerTool(
            "execute_rcon_command",
            {
                title: "Execute RCON Command",
                description: "Use when the user wants to run a Minecraft command (like /give, /tp, /gamemode) or needs to execute RCON commands. Displays command output.",
                inputSchema: {
                    command: z.string().describe("The RCON command to execute (without leading slash)")
                },
                annotations: {
                    readOnlyHint: false
                },
                _meta: {
                    "openai/outputTemplate": "ui://widget/rcon-output.html",
                    "openai/toolInvocation/invoking": "Executing command...",
                    "openai/toolInvocation/invoked": "Command completed"
                }
            },
            async ({ command }: { command: string }) => {
                try {
                    const result = await callWorkerAPI('/api/rcon/execute', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command })
                    }) as any;

                    return {
                        content: [{
                            type: "text" as const,
                            text: result.success 
                                ? `Command executed: ${command}\nOutput: ${result.output || '(no output)'}`
                                : `Command failed: ${result.error}`
                        }],
                        structuredContent: result as Record<string, unknown>
                    };
                } catch (error) {
                    console.error("Failed to execute RCON command:", error);
                return {
                        content: [{ type: "text" as const, text: `Failed to execute command: ${command}` }],
                        structuredContent: {
                            success: false,
                            output: '',
                            command,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        } as Record<string, unknown>
                    };
                }
            }
        );
    }
}

export default class MineflareAgentWorker extends WorkerEntrypoint<typeof agentWorker.Env>{
    mfAgent = MineflareAgent.serve('/');

    /**
     * Custom fetch handler to intercept OAuth metadata requests
     * This runs before the MCP protocol handler
     */
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        
        console.log("[MineflareAgent] Incoming request:", {
            method: request.method,
            pathname: url.pathname,
            hasAuthHeader: request.headers.has("Authorization")
        });

        // Handle OAuth Authorization Server Metadata Discovery (RFC8414)
        // This MUST be at the root level per the spec
        if (url.pathname === "/.well-known/oauth-authorization-server") {
            console.log("[MineflareAgent] OAuth metadata discovery request received");
            console.log("[MineflareAgent] MCP-Protocol-Version header:", request.headers.get("MCP-Protocol-Version"));
            
            const metadata = getOAuthMetadata();
            
            console.log("[MineflareAgent] Returning OAuth metadata discovery response");
            const metadataResponse = new Response(JSON.stringify(metadata, null, 2), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "public, max-age=3600", // Cache for 1 hour per spec recommendations
                },
            });
            console.log("[MineflareAgent] Response status:", metadataResponse.status);
            return metadataResponse;
        }

        // For all other requests, check OAuth token
        // Per AUTH.md: "authorization MUST be included in every HTTP request from client to server"
        console.log("[MineflareAgent] Checking OAuth authorization for MCP request");
        const authError = await validateMcpBearerToken(request);
        if (authError) {
            console.log("[MineflareAgent] Authorization failed - returning error response");
            console.log("[MineflareAgent] Response status:", authError.status, authError.statusText);
            return authError;
        }

        console.log("[MineflareAgent] Authorization successful - proceeding to MCP protocol handler");
        
        // If authorized, proceed with normal MCP handling
        const response = await this.mfAgent.fetch(request, this.env, this.ctx);
        
        console.log("[MineflareAgent] Response status:", response.status, response.statusText);
        
        return response;
    }

};
