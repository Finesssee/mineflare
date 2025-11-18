export type ServerProfileLabel = "legacy" | "stable" | "experimental" | "modded";
export type ServerLoader = "PAPER" | "FORGE" | "FABRIC" | "NEOFORGE";

export interface ServerProfile {
  id: string;
  minecraftVersion: string;
  name: string;
  description: string;
  label: ServerProfileLabel;
  type: ServerLoader;
  fabric?: {
    loaderVersion: string;
    installerVersion: string;
  };
  neoforgeVersion?: string;
}

export const SERVER_PROFILES: ServerProfile[] = [
  {
    id: "paper-1-21-10",
    minecraftVersion: "1.21.10",
    label: "experimental",
    type: "PAPER",
    name: "Paper 1.21.10",
    description: "Latest Paper build with bleeding-edge gameplay tweaks. Expect the fastest updates but possible instability."
  },
  {
    id: "paper-1-21-8",
    minecraftVersion: "1.21.8",
    label: "stable",
    type: "PAPER",
    name: "Paper 1.21.8",
    description: "Recommended build for most servers. Balanced between performance and plugin compatibility."
  },
  {
    id: "paper-1-21-7",
    minecraftVersion: "1.21.7",
    label: "legacy",
    type: "PAPER",
    name: "Paper 1.21.7",
    description: "Legacy Paper build for players who need older plugin compatibility."
  },
  {
    id: "paper-1-20-6",
    minecraftVersion: "1.20.6",
    label: "legacy",
    type: "PAPER",
    name: "Paper 1.20.6",
    description: "Long-term support release compatible with many established plugin stacks."
  },
  {
    id: "paper-1-19-4",
    minecraftVersion: "1.19.4",
    label: "legacy",
    type: "PAPER",
    name: "Paper 1.19.4",
    description: "Ideal for older adventure maps and plugin ecosystems that have not migrated to 1.20+."
  },
  {
    id: "forge-1-20-1",
    minecraftVersion: "1.20.1",
    label: "modded",
    type: "FORGE",
    name: "Forge 1.20.1",
    description: "Most popular Forge line for large modpacks. The server jar is downloaded on first boot and expects your mods in /data/mods."
  },
  {
    id: "forge-1-19-2",
    minecraftVersion: "1.19.2",
    label: "modded",
    type: "FORGE",
    name: "Forge 1.19.2",
    description: "Long-lived Forge release used by many Create/All The Mods packs. Downloads Forge runtime on first boot."
  },
  {
    id: "forge-1-18-2",
    minecraftVersion: "1.18.2",
    label: "modded",
    type: "FORGE",
    name: "Forge 1.18.2",
    description: "Popular Forge baseline for adventure/RPG modpacks. Cached installer runs automatically when the server starts."
  },
  {
    id: "forge-1-16-5",
    minecraftVersion: "1.16.5",
    label: "modded",
    type: "FORGE",
    name: "Forge 1.16.5",
    description: "Classic Forge branch for older kitchen-sink packs. Keeps legacy Redstone/Tech mods compatible."
  },
  {
    id: "neoforge-1-21-1",
    minecraftVersion: "1.21.1",
    label: "modded",
    type: "NEOFORGE",
    name: "NeoForge 1.21.1",
    description: "Modern NeoForge line for the newest 1.21.x modpacks. Automatically installs NeoForge before loading mods in /data/mods."
  },
  {
    id: "neoforge-1-20-4",
    minecraftVersion: "1.20.4",
    label: "modded",
    type: "NEOFORGE",
    name: "NeoForge 1.20.4",
    description: "Stable NeoForge profile covering popular 1.20.4 questing/create packs. Uses upstream installers cached on first boot."
  },
  {
    id: "neoforge-1-20-1",
    minecraftVersion: "1.20.1",
    label: "modded",
    type: "NEOFORGE",
    name: "NeoForge 1.20.1",
    description: "Brings long-lived 1.20.1 NeoForge modpacks to Mineflare without redeploying. Drop mods into /data/mods and restart."
  },
  {
    id: "fabric-1-21-1",
    minecraftVersion: "1.21.1",
    label: "modded",
    type: "FABRIC",
    name: "Fabric 1.21.1",
    description: "Lightweight Fabric loader for modern mods. Downloads Fabric automatically on startup; drop mods into /data/mods.",
    fabric: {
      loaderVersion: "0.16.5",
      installerVersion: "1.0.1"
    }
  },
  {
    id: "fabric-1-20-1",
    minecraftVersion: "1.20.1",
    label: "modded",
    type: "FABRIC",
    name: "Fabric 1.20.1",
    description: "Modern Fabric baseline with Quilt-compatible loader. Perfect for Lithium/Sodium stacks or lightweight SMPs.",
    fabric: {
      loaderVersion: "0.15.11",
      installerVersion: "1.0.1"
    }
  },
  {
    id: "fabric-1-19-2",
    minecraftVersion: "1.19.2",
    label: "modded",
    type: "FABRIC",
    name: "Fabric 1.19.2",
    description: "Stable Fabric line for 1.19-era modpacks and servers focused on performance.",
    fabric: {
      loaderVersion: "0.14.22",
      installerVersion: "1.0.1"
    }
  },
  {
    id: "fabric-1-18-2",
    minecraftVersion: "1.18.2",
    label: "modded",
    type: "FABRIC",
    name: "Fabric 1.18.2",
    description: "Great for Create-based packs that prefer Fabric tooling. Loader boots automatically; drop mods into /data/mods.",
    fabric: {
      loaderVersion: "0.14.9",
      installerVersion: "1.0.1"
    }
  }
];

export const DEFAULT_SERVER_PROFILE_ID = "paper-1-21-8";

export const SERVER_PROFILE_MAP = new Map(SERVER_PROFILES.map((profile) => [profile.id, profile] as const));
