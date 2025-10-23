/// <reference types="@types/bun" />

import { $ } from "bun";
import { createHash } from "crypto";
import { readdirSync, statSync, readFileSync, existsSync } from "fs";
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


if(existsSync(".BASE_DOCKERFILE") && process.env.CI) {
    // For now speed up cloudflare workers CI by using the cached base image
    console.log("Using cached base image", readFileSync(".BASE_DOCKERFILE", "utf-8"));
    process.exit(0);
}

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

// Compute and cache the build state for build-container-services.sh
const BUILD_SERVICES_SCRIPT = "./build-container-services.sh";
const BUILD_SERVICES_CACHE_FILE = ".BUILD_CONTAINER_SERVICES";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

let shouldRunBuildServices = true;
let buildServicesHash = "";
const nowMs = Date.now();

try {
    const hash = createHash("sha256");
    
    // Hash the build script itself
    const scriptContent = readFileSync(BUILD_SERVICES_SCRIPT);
    hash.update(scriptContent);
    
    // Hash the source files that the script compiles
    const sourceFiles = [
        "./http-proxy.ts",
        "./file-server.ts",
    ];
    
    for (const sourceFile of sourceFiles) {
        try {
            const sourceContent = readFileSync(sourceFile);
            hash.update(sourceFile); // Include filename for clarity
            hash.update(sourceContent);
        } catch (error) {
            console.warn(`Could not read ${sourceFile} to compute hash; will run build script.`, error);
            // If we can't read a source file, force rebuild
            shouldRunBuildServices = true;
            break;
        }
    }
    
    buildServicesHash = hash.digest("hex");
} catch (error) {
    console.warn("Could not read build-container-services.sh to compute hash; will run it.", error);
}

if (buildServicesHash && existsSync(BUILD_SERVICES_CACHE_FILE)) {
    try {
        const cacheRaw = readFileSync(BUILD_SERVICES_CACHE_FILE, "utf-8");
        const cache = JSON.parse(cacheRaw) as { hash: string; lastRunMs: number };
        const hashMatches = cache.hash === buildServicesHash;
        const recentlyRan = (nowMs - cache.lastRunMs) < SIX_HOURS_MS;
        
        // Verify all required binaries exist
        const requiredBinaries = [
            "./http-proxy-x64",
            "./http-proxy-arm64",
            "./file-server-x64",
            "./file-server-arm64",
            "./hteetp-linux-x64",
            "./hteetp-linux-arm64",
            "./ttyd-x64",
            "./ttyd-arm64",
            "./claude-x64",
            "./claude-arm64",
            "./codex-x64",
            "./codex-arm64",
            "./gemini-x64",
            "./gemini-arm64",
            "./chrome-x64.tar.gz",
            "./chrome-arm64.tar.gz",
            "./mineflare-x64",
            "./mineflare-arm64",
        ];
        
        const allBinariesExist = requiredBinaries.every(binary => existsSync(binary));
        
        // If binaries are missing, always rebuild regardless of cache state
        if (!allBinariesExist) {
            console.log("Some binaries are missing, rebuilding container services");
            shouldRunBuildServices = true;
        } else if (hashMatches && recentlyRan) {
            shouldRunBuildServices = false;
            console.log("Skipping build-container-services: hash unchanged and ran within last 6 hours");
        }
    } catch (error) {
        console.warn("Failed to read/parse .BUILD_CONTAINER_SERVICES; will run build-container-services", error);
    }
}

if (shouldRunBuildServices) {
    await $`bash ${BUILD_SERVICES_SCRIPT}`.catch((error) => {
        console.error(error)
        console.error("Failed to build container services")
        process.exit(1)
    })
    try {
        await Bun.write(BUILD_SERVICES_CACHE_FILE, JSON.stringify({ hash: buildServicesHash, lastRunMs: nowMs }));
        console.log("✓ Updated .BUILD_CONTAINER_SERVICES cache");
    } catch (error) {
        console.warn("Failed to write .BUILD_CONTAINER_SERVICES cache", error);
    }
} else {
    console.log("✓ Using cached container services build");
}

// Build single multi-version container image
const contentHash = hashDirectory(import.meta.dirname);
const tag = `${REPO}:multi-${contentHash}`;
const latestTag = `${REPO}:latest`;

console.log(`\n=== Building Multi-Version Paper Container ===`);
console.log(`Image: ${tag}`);
console.log(`This image includes Paper versions: 1.21.7, 1.21.8, 1.21.10`);

// Check if image exists locally first; if not, try pulling from remote
let imageExists = false;
try {
    console.log(`Checking if image ${tag} exists locally...`);
    await $`docker image inspect ${tag}`.quiet();
    imageExists = true;
    console.log(`✓ Image ${tag} found locally, skipping build`);
} catch (localError) {
    if (localError.stderr?.includes("No such image") || localError.stderr?.includes("No such object") || localError.stderr?.toLowerCase?.().includes("not found")) {
        console.log(`Image ${tag} not found locally. Attempting to pull from registry...`);
        try {
            await $`docker pull ${tag}`;
            imageExists = true;
            console.log(`✓ Pulled ${tag} from registry, skipping build`);
        } catch (pullError) {
            if (pullError.stderr?.includes("not found") || pullError.stderr?.includes("pull access denied")) {
                console.log("Image not found in registry; will build it");
            } else {
                console.log(JSON.stringify(pullError.stderr, null, 2));
                console.error("Unexpected error while pulling image:", pullError);
            }
        }
    } else {
        console.error("Unexpected error while checking local image:", localError);
    }
}

// Only build and push if image doesn't exist
if (!imageExists) {
    console.log(`Building multi-arch image ${tag} for platforms: ${PLATFORMS}...`);
    
    // Check if we can use the cache by verifying if the image exists remotely
    let cacheFromFlag = "";
    try {
        await $`docker manifest inspect ${tag}`.quiet();
        cacheFromFlag = `--cache-from type=registry,ref=${tag}`;
        console.log(`✓ Found cache image ${tag}, will use for build optimization`);
    } catch (cacheError) {
        console.log(`Cache image ${tag} not found, building without cache`);
    }
    
    // Build the image with or without cache based on availability
    if (skipPush) {
        await $`docker buildx build --platform ${PLATFORMS} ${cacheFromFlag} --progress=plain --output type=cacheonly -t ${tag} -t ${latestTag} .`
            .catch((error) => {
                console.error(error)
                console.error(`Failed to build multi-version container image`)
                process.exit(1)
            })
    } else {
        await $`docker buildx build --platform ${PLATFORMS} ${cacheFromFlag} --progress=plain --push -t ${tag} -t ${latestTag} .`
            .catch((error) => {
                console.error(error)
                console.error(`Failed to build multi-version container image`)
                process.exit(1)
            })
    }
    
    if (skipPush) {
        console.log(`✓ Successfully validated multi-arch build for ${tag} (${PLATFORMS})`);
    } else {
        console.log(`✓ Successfully built and pushed multi-arch ${tag} and ${latestTag} for ${PLATFORMS}`);
    }
}

// Write the tag to .BASE_DOCKERFILE for Alchemy to consume
await Bun.write(".BASE_DOCKERFILE", tag);
console.log(`\n✓ Successfully wrote tag to .BASE_DOCKERFILE: ${tag}`);
console.log(`\n✓ Built single multi-version image containing Paper 1.21.7, 1.21.8, and 1.21.10`);

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
