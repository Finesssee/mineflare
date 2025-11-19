import { useState, useMemo, useCallback } from 'preact/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ServerInfo,
  ServerState,
  ServerStatus,
  PlayerResponse,
  Plugin,
  VersionResponse,
  SupportedVersion,
  ConnectionInfo,
} from '../types/api';
import { fetchWithAuth } from '../utils/api';

type ServerSnapshot = {
  status: ServerStatus | null;
  players: string[];
  info: ServerInfo | null;
  plugins: Plugin[];
  connectionInfo: ConnectionInfo | null;
  serverState: ServerState;
  startupStep: string | null;
  serverVersion: string;
  supportedVersions: SupportedVersion[];
  canChangeVersion: boolean;
};

const SERVER_DATA_QUERY_KEY = ['server-data'] as const;

async function fetchJson<T>(path: string, init?: Parameters<typeof fetchWithAuth>[1]): Promise<T> {
  const response = await fetchWithAuth(path, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Request to ${path} failed`);
  }
  return response.json() as Promise<T>;
}

const normalizeState = (status: string): ServerState => {
  switch (status) {
    case 'running':
    case 'healthy':
      return 'running';
    case 'stopping':
      return 'stopping';
    case 'starting':
      return 'starting';
    case 'maintenance':
      return 'maintenance';
    default:
      return 'stopped';
  }
};

async function fetchServerSnapshot(): Promise<ServerSnapshot> {
  const { status: rawStatus } = await fetchJson<{ status: string; lastChange: number }>('/api/getState');
  const serverState = normalizeState(rawStatus);

  const baseRequests = [
    fetchJson<{ plugins: Plugin[] }>('/api/plugins'),
    fetchJson<ConnectionInfo>('/api/connection-info').catch(() => null),
    fetchJson<VersionResponse>('/api/version'),
  ] as const;

  let status: ServerStatus | null = null;
  let players: string[] = [];
  let info: ServerInfo | null = null;
  let startupStep: string | null = null;

  if (serverState === 'running' || serverState === 'maintenance') {
    const [statusData, playersData, infoData, startupData] = await Promise.all([
      fetchJson<ServerStatus>('/api/status'),
      fetchJson<PlayerResponse>('/api/players'),
      fetchJson<ServerInfo>('/api/info'),
      fetchJson<{ startupStep: string | null }>('/api/startup-status').catch(() => ({ startupStep: null })),
    ]);
    status = statusData;
    players = playersData.players || [];
    info = infoData;
    startupStep = startupData.startupStep ?? null;
  } else if (serverState === 'starting') {
    const startupData = await fetchJson<{ startupStep: string | null }>('/api/startup-status').catch(() => ({ startupStep: null }));
    startupStep = startupData.startupStep ?? null;
  }

  const [pluginsData, connectionInfo, versionData] = await Promise.all(baseRequests);

  return {
    status,
    players,
    info,
    plugins: pluginsData.plugins || [],
    connectionInfo,
    serverState,
    startupStep,
    serverVersion: versionData.version,
    supportedVersions: versionData.supported,
    canChangeVersion: versionData.canChange,
  };
}

export function useServerData(isAuthenticated: boolean) {
  const queryClient = useQueryClient();
  const [localError, setLocalError] = useState<string | null>(null);
  const [transitionState, setTransitionState] = useState<ServerState | null>(null);

  const serverQuery = useQuery<ServerSnapshot>({
    queryKey: SERVER_DATA_QUERY_KEY,
    queryFn: fetchServerSnapshot,
    enabled: isAuthenticated,
    refetchInterval: (query) => {
      const snapshot = query.state.data as ServerSnapshot | undefined;
      const state = transitionState ?? snapshot?.serverState;
      if (state === 'running') return 5000;
      if (state === 'maintenance' || state === 'starting') return 7000;
      if (state === 'stopping') return 4000;
      return 12000;
    },
    refetchIntervalInBackground: true,
  });

  const invalidateServerData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: SERVER_DATA_QUERY_KEY });
  }, [queryClient]);

  const startServerMutation = useMutation({
    mutationFn: async () => {
      await fetchWithAuth('/api/status');
    },
    onMutate: () => {
      setLocalError(null);
      setTransitionState('starting');
    },
    onError: (error) => {
      setLocalError(error instanceof Error ? error.message : 'Failed to start server');
    },
    onSettled: () => {
      setTransitionState(null);
      invalidateServerData();
    },
  });

  const stopServerMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth('/api/shutdown', {
        method: 'POST',
      });
      const result = await response.json() as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to stop server');
      }
    },
    onMutate: () => {
      setLocalError(null);
      setTransitionState('stopping');
    },
    onError: (error) => {
      setLocalError(error instanceof Error ? error.message : 'Failed to stop server');
    },
    onSettled: () => {
      setTransitionState(null);
      invalidateServerData();
    },
  });

  const effectiveState = transitionState ?? serverQuery.data?.serverState ?? 'stopped';

  const refresh = useCallback(async () => {
    setLocalError(null);
    await serverQuery.refetch();
  }, [serverQuery]);

  const togglePlugin = useCallback(async (filename: string, enabled: boolean) => {
    setLocalError(null);
    const response = await fetchWithAuth(`/api/plugins/${filename}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const result = await response.json() as { success: boolean; plugins?: Plugin[]; error?: string };
    if (!result.success || !result.plugins) {
      throw new Error(result.error || 'Failed to toggle plugin');
    }
    queryClient.setQueryData<ServerSnapshot | undefined>(SERVER_DATA_QUERY_KEY, current => {
      if (!current) return current;
      return { ...current, plugins: result.plugins! };
    });
  }, [queryClient]);

  const updateVersion = useCallback(async (version: string) => {
    setLocalError(null);
    const response = await fetchWithAuth('/api/version', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    });
    const result = await response.json() as { success: boolean; error?: string };
    if (!result.success) {
      throw new Error(result.error || 'Failed to update version');
    }
    invalidateServerData();
  }, [invalidateServerData]);

  const loading = serverQuery.isLoading || (serverQuery.isFetching && !serverQuery.data);
  const queryError = serverQuery.error instanceof Error ? serverQuery.error.message : null;
  const error = localError ?? queryError;

  return {
    status: serverQuery.data?.status ?? null,
    players: serverQuery.data?.players ?? [],
    info: serverQuery.data?.info ?? null,
    plugins: serverQuery.data?.plugins ?? [],
    connectionInfo: serverQuery.data?.connectionInfo ?? null,
    loading,
    error,
    serverState: effectiveState,
    startupStep: serverQuery.data?.startupStep ?? null,
    serverVersion: serverQuery.data?.serverVersion ?? 'paper-1-21-8',
    supportedVersions: serverQuery.data?.supportedVersions ?? [],
    canChangeVersion: serverQuery.data?.canChangeVersion ?? false,
    startServer: () => startServerMutation.mutateAsync(),
    stopServer: () => stopServerMutation.mutateAsync(),
    refresh,
    togglePlugin,
    updateVersion,
  };
}
