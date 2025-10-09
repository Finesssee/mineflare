/// <reference types="@types/bun" />

import { $ } from "bun";
import { createHash } from "crypto";
import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

// This script builds and pushes the docker image to the cloudflare container registry

const REPO = process.env.BASE_DOCKERFILE ?? "andrewjefferson/mineflare-base"
const PLATFORMS = process.env.DOCKER_PLATFORMS ?? "linux/amd64,linux/arm64"
let skipPush = process.env.SKIP_PUSH ?.toLowerCase() === "true"
if(!skipPush && process.env.CI) {
    skipPush = true
}

// change cwd to the directory of the script
process.chdir(import.meta.dirname)

// Ensure buildx builder exists and is using it
console.log("Setting up Docker buildx...");
try {
    await $`docker buildx use multiarch-builder`;
    console.log("Using existing buildx builder");
} catch {
    // Builder doesn't exist, create it
    await $`docker buildx create --name multiarch-builder --use`;
    console.log("Created new buildx builder");
}

const buildContainerServices = await $`bash ./build-container-services.sh`.catch((error) => {
    console.error(error)
    console.error("Failed to build container services")
    process.exit(1)
})

const contentHash = hashDirectory(import.meta.dirname);
console.log(`Directory content hash: ${contentHash}`);
const tag = `${REPO}:${contentHash}`

// Check if multi-arch image exists using manifest inspect
let imageExists = false;
try {
    console.log(`Checking if multi-arch image ${tag} exists...`);
    await $`docker manifest inspect ${tag}`;
    imageExists = true;
    console.log(`✓ Image ${tag} already exists, skipping build`);
} catch (error) {
    if(error.stderr.includes("no such manifest") || error.stderr.includes("not found") || error.stderr.includes("failed to resolve reference")) {
        console.log("Image not found, will build it");
    } else {
        // Unexpected error during manifest check
        console.error("Unexpected error while checking manifest:", error);
    }
}

// Only build and push if image doesn't exist
if (!imageExists) {
    console.log(`Building multi-arch image ${tag} for platforms: ${PLATFORMS}...`);
    
    // Build multi-arch image with buildx and push (buildx requires --push for multi-platform)
    await $`docker buildx build --platform ${PLATFORMS} --cache-from type=registry,ref=${tag} --cache-to type=inline ${skipPush ? "" : "--push"} -t ${tag} .`
        .catch((error) => {
            console.error(error)
            console.error("Failed to build multi-arch image")
            process.exit(1)
        })
    
    console.log(`✓ Successfully built and pushed multi-arch ${tag} for ${PLATFORMS}`);
}

// Write the repo name and tag to a file using Bun
await Bun.write(".BASE_DOCKERFILE", tag);
console.log(`✓ Successfully wrote tag to use in .BASE_DOCKERFILE`);

// Calculate hash of directory contents
function hashDirectory(dirPath: string): string {
    const hash = createHash('sha256');
    
    function processDirectory(dir: string) {
        const items = readdirSync(dir).sort(); // Sort for consistent hashing
        
        for (const item of items) {
            if(item.startsWith(".")) {
                // skip hidden files and directories
                continue;
            }
            const fullPath = join(dir, item);
            const relativePath = fullPath.replace(dirPath + '/', '');
            const stats = statSync(fullPath);
            
            if (stats.isDirectory()) {
                hash.update(relativePath);
                processDirectory(fullPath);
            } else if (stats.isFile()) {
                hash.update(relativePath);
                const content = readFileSync(fullPath);
                hash.update(content);
            }
        }
    }
    
    processDirectory(dirPath);
    return hash.digest('hex').substring(0, 12); // Use first 12 chars for brevity
}
