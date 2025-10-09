import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export class MineflareAgent extends McpAgent {
    server = new McpServer({ name: "Mineflare", version: "v1.0.0" });

    async init() {
        this.server.registerResource(
            "mineflare-info",
            "ui://widget/mineflare-info.html",
            {},
            async () => ({
                contents: [
                    {
                        uri: "ui://widget/mineflare-info.html",
                        mimeType: "text/html+skybridge",
                        text:`
                        <div>
                            <h1>Mineflare</h1>
                            <p>This is the Mineflare MCP agent</p>
                        </div>
                        `.trim()
                    }
                ]
            })
        );

        this.server.registerTool(
            "mineflare-status", 
            {
                title: "Mineflare Status",
                _meta: {
                    "openai/outputTemplate": "ui://widget/mineflare-info.html",
                    "openai/toolInvocation/invoking": "Hand-tossing a map",
                    "openai/toolInvocation/invoked": "Served a fresh map"
                },
                inputSchema: {
                    serverName: z.string()
                }
            },
            async ({ serverName }) => {
                console.log("Getting status for server", serverName);
                return {
                    content: [{ type: "text", text: "Server is running" }],
                    structuredContent: {}
                }
            }
        );

    }
}

export default MineflareAgent.serve('/');
