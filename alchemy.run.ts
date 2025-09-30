/// <reference types="@types/node" />

import alchemy from "alchemy";
import { Container, R2Bucket, BunSPA } from "alchemy/cloudflare";
import { SQLiteStateStore } from "alchemy/state";
import { MinecraftContainer } from "./src/container.ts";

const app = await alchemy("cloudflare-container", {
  stateStore: (scope) => new SQLiteStateStore(scope),
  password: process.env.ALCHEMY_PASSWORD,
});

export const container = await Container<MinecraftContainer>("container3", {
  name: `${app.name}-container-${app.stage}`,
  className: "MinecraftContainer",
  adopt: true,
  build: {
    context: import.meta.dirname,
    dockerfile: "container_src/Dockerfile",
  },
  instanceType: "standard"
});



// R2 bucket for Dynmap tiles and web UI
const dynmapBucket = await R2Bucket("dynmap-tiles", {
  name: `${app.name}-dynmap-${app.stage}`,
  // Enable public access - tiles and UI served directly from R2.dev domain
  allowPublicAccess: true,
  // CORS config allows browser JS to fetch tiles and call Worker API
  cors: [
    {
      allowed: {
        origins: ["*"], // Permissive CORS for ease of use
        methods: ["GET", "HEAD"],
        headers: ["*"],
      },
    },
  ],
});

export const worker = await BunSPA("minecraft-site", {
  name: `${app.name}-worker-${app.stage}`,
  entrypoint: "src/worker.ts",
  frontend: "index.html",
  adopt: true,
  compatibility: "node",
  compatibilityFlags: ["enable_ctx_exports"],
  compatibilityDate: "2025-09-27",
  bindings: {
    MINECRAFT_CONTAINER: container,
    DYNMAP_BUCKET: dynmapBucket,

    // Secrets for Tailscale
    TS_AUTHKEY: alchemy.secret(process.env.TS_AUTHKEY),
    NODE_ENV: process.env.NODE_ENV ?? 'development',

    // R2 API credentials for container (Dynmap S3 access)
    // These allow the container to write tiles directly to R2
    // Get these from Cloudflare Dashboard > R2 > Manage R2 API Tokens
    R2_ACCESS_KEY_ID: alchemy.secret(process.env.R2_ACCESS_KEY_ID),
    R2_SECRET_ACCESS_KEY: alchemy.secret(process.env.R2_SECRET_ACCESS_KEY),

    // Your Cloudflare Account ID (find in Dashboard URL or Account Home)
    // Format: 32-character hex string
    CLOUDFLARE_ACCOUNT_ID: alchemy.secret(process.env.CLOUDFLARE_ACCOUNT_ID),

    // Bucket name (passed to container for Dynmap config)
    R2_BUCKET_NAME: dynmapBucket.name,
  },
});

console.log("Worker URL:", worker.url);
console.log("Dynmap URL:", `https://${dynmapBucket.domain}`);

await app.finalize();
