
import {
    env as workerEnv
} from "cloudflare:workers";
import { worker } from "../../alchemy.run";
import type { ContinentCode } from "@cloudflare/workers-types";
import type { DurableObjectLocationHint } from "@cloudflare/workers-types";
import { AsyncLocalStorage } from "async_hooks";


const env = workerEnv as typeof worker.Env;
const singletonContainerId = "mineflare-singleton-container";

export const asyncLocalStorage = new AsyncLocalStorage<{ cf: CfProperties | undefined }>();

export function getMinecraftContainer() {
    const cf = asyncLocalStorage.getStore()?.cf;
    if(!cf) {
        const containerId = env.MINECRAFT_CONTAINER.idFromName(singletonContainerId);
        console.log("No cf object found in async local storage. Skipping location hint.");
        return env.MINECRAFT_CONTAINER.get(containerId);
    }
    const locationHint = getLocationHint(cf);
    const containerId = env.MINECRAFT_CONTAINER.idFromName(singletonContainerId + "-" + locationHint);
    console.log("setting location hint to", locationHint, "based on request");
    return env.MINECRAFT_CONTAINER.get(containerId, { locationHint });
}

function exhaustiveCheck(value: never): never {
    throw new Error(`Exhaustive check failed: ${value}`);
}


    //     Parameter	Location
    // wnam	Western North America
    // enam	Eastern North America
    // sam	South America 2
    // weur	Western Europe
    // eeur	Eastern Europe
    // apac	Asia-Pacific
    // oc	Oceania
    // afr	Africa 2
    // me	Middle East 2

    // declare type ContinentCode = "AF" | "AN" | "AS" | "EU" | "NA" | "OC" | "SA"
    
/**
 * Get the location hint for the Minecraft container based on contient and longitude 
 * properties of the incoming request request.cf object.
 * @param request The request object
 * @returns The location hint
 * @see https://developers.cloudflare.com/workers/runtime-apis/request/#requestcf for info on the request.cf object
 */
function getLocationHint(cf: CfProperties): DurableObjectLocationHint | undefined {
    try {
        /**
         * Longitude of the incoming request
         *
         * @example "-97.74260"
         */
        const longitude = typeof cf.longitude === "string" ? parseFloat(cf.longitude) : typeof cf.longitude === "number" ? cf.longitude : undefined;
        const cfParams = cf.continent as ContinentCode | undefined;
        switch(cfParams) {
            case "AF":
                return "afr";
            case "AN":
                return "sam";
            case "AS":
                if(longitude && longitude < 60) {
                    return "me";
                }
                return "apac";
            case "EU":
                if(longitude && longitude > 17) {
                    return "eeur";
                }
                return "weur";
            case "NA":
                if(longitude && longitude > -95) {
                    return "enam";
                }
                return "wnam";
            case "OC":
                return "oc";
            case "SA":
                return "sam";
            case undefined:
                return "enam";
            default:
                exhaustiveCheck(cfParams);
        }
    } catch (error) {
        console.error("Error getting location hint", error);
        return undefined;
    }
}