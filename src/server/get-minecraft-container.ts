
import {
    env as workerEnv
} from "cloudflare:workers";
import { worker } from "../../alchemy.run";
import { getContainer } from "@cloudflare/containers";


const env = workerEnv as typeof worker.Env;

export function getMinecraftContainer() {
    
    return getContainer(env.MINECRAFT_CONTAINER);
}
