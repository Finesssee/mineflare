
import {
    env as workerEnv
} from "cloudflare:workers";
import { worker } from "../../alchemy.run";
import type { ContinentCode } from "@cloudflare/workers-types";
import { getContainer } from "@cloudflare/containers";
import type { DurableObjectLocationHint } from "@cloudflare/workers-types";


const env = workerEnv as typeof worker.Env;
const singletonContainerId = "cf-singleton-container";

export function getMinecraftContainer(request: Request) {
    

   const locationHint = getLocationHint(request);
   console.log("setting location hint to", locationHint, "based on request", request.cf);

    const containerId = env.MINECRAFT_CONTAINER.idFromName(singletonContainerId);
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

    // declare type ContinentCode = "AF" | "AN" | "AS" | "EU" | "NA" | "OC" | "SA";
function getLocationHint(request: Request): DurableObjectLocationHint {
      /**
   * Longitude of the incoming request
   *
   * @example "-97.74260"
   */
  const longitude = typeof request.cf?.longitude === "string" ? parseFloat(request.cf.longitude) : typeof request.cf?.longitude === "number" ? request.cf.longitude : undefined;
    const cfParams = request.cf?.continent as ContinentCode | undefined;
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
}