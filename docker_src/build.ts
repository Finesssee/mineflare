/// <reference types="@types/bun" />

import { $ } from "bun";
// This script builds and pushes the docker image to the cloudflare container registry


const REPO = process.env.BASE_DOCKERFILE ?? "andrewjefferson/mineflare-base"
// Try to pull the latest image first
try {
    const pull = await $`docker pull ${REPO}:latest`
} catch (error) {
    if(error.stderr.includes("failed to resolve reference")) {
        console.log("Repo not found, keep going")
    }
}

// Build with cache-from
const build = await $`docker build --cache-from ${REPO}:latest -t ${REPO}:latest .`
    .catch((error) => {
        console.error(error)
        console.error("Failed to build image")
        process.exit(1)
    })

const push = await $`docker push ${REPO}:latest`.catch((error) => {
    console.error(error)
    console.error("Failed to push image")
    process.exit(1)
})
