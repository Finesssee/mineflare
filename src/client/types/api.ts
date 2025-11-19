export interface ServerStatus {
  online: boolean;
  playerCount?: number;
  maxPlayers?: number;
  error?: string;
}

export interface PlayerResponse {
  players: string[];
  error?: string;
}

export interface ServerInfo {
  serverType?: string;
  version?: string;
  versionName?: string;
  versionId?: string;
  data?: string;
  series?: string;
  protocol?: string;
  buildTime?: string;
  packResource?: string;
  packData?: string;
  stable?: string;
  motd?: string;
  error?: string;
}

export interface ContainerInfo {
  id: string;
  health: boolean;
  online: boolean;
  playerCount?: number;
  maxPlayers?: number;
  error?: string;
}

export type PluginState = 'ENABLED' | 'DISABLED_WILL_ENABLE_AFTER_RESTART' | 'ENABLED_WILL_DISABLE_AFTER_RESTART' | 'DISABLED';

export type PluginStatus = 
  | { type: "no message" }
  | { type: "information"; message: string }
  | { type: "warning"; message: string }
  | { type: "alert"; message: string };

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'maintenance';

export interface Plugin {
  filename: string;
  displayName: string;
  state: PluginState;
  requiredEnv: Array<{ name: string; description: string }>;
  configuredEnv: Record<string, string>;
  status: PluginStatus;
}

export interface PluginsResponse {
  plugins: Plugin[];
}

export type TunnelStatus = 'not-configured' | 'server-stopped' | 'pending' | 'connected' | 'error';

export interface ConnectionInfo {
  configured: boolean;
  hostname?: string;
  status: TunnelStatus;
  message: string;
  logs?: string[];
}

export type VersionLabel = 'legacy' | 'stable' | 'experimental' | 'modded' | 'unknown';

export interface SupportedVersion {
  version: string;
  label: VersionLabel;
  minecraftVersion: string;
  name: string;
  description: string;
  type: 'PAPER' | 'FORGE' | 'FABRIC' | 'NEOFORGE';
}

export interface VersionResponse {
  version: string;
  label: VersionLabel | 'unknown';
  supported: SupportedVersion[];
  canChange: boolean;
  error?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number | null;
  modified: number | null;
}

export interface FileListResponse {
  root: string;
  path: string;
  parent: string | null;
  entries: FileEntry[];
  error?: string;
}
