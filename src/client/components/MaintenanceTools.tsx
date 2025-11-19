import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ServerState, FileEntry, FileListResponse } from '../types/api';
import { fetchWithAuth } from '../utils/api';

const fileListQueryKey = (path: string) => ['files', path] as const;
const fileContentQueryKey = (path: string) => ['file-content', path] as const;

async function ensureOk(response: Response, fallbackMessage: string) {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || fallbackMessage);
  }
  return response;
}

async function getDirectoryListing(path: string): Promise<FileListResponse> {
  const search = path ? `?path=${encodeURIComponent(path)}` : '';
  const response = await fetchWithAuth(`/api/files/list${search}`);
  const safeResponse = await ensureOk(response, 'Failed to load directory');
  return safeResponse.json() as Promise<FileListResponse>;
}

async function getFileContents(path: string): Promise<string> {
  const response = await fetchWithAuth(`/api/files/file?path=${encodeURIComponent(path)}`);
  const safeResponse = await ensureOk(response, 'Failed to load file');
  return safeResponse.text();
}

async function writeFileContents(path: string, body: BodyInit) {
  const response = await fetchWithAuth(`/api/files/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    body,
  });
  await ensureOk(response, 'Failed to write file');
}

async function createDirectoryRequest(path: string) {
  const response = await fetchWithAuth('/api/files/directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  await ensureOk(response, 'Failed to create folder');
}

interface MaintenanceToolsProps {
  serverState: ServerState;
  onRefresh: () => void | Promise<void>;
}

export function MaintenanceTools({ serverState, onRefresh }: MaintenanceToolsProps) {
  const queryClient = useQueryClient();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'enter' | 'exit' | null>(null);

  const maintenanceMutation = useMutation({
    mutationFn: async (action: 'enter' | 'exit') => {
      if (action === 'enter' && serverState !== 'stopped') {
        throw new Error('Stop the Minecraft server before entering maintenance mode.');
      }
      if (action === 'exit' && serverState !== 'maintenance') {
        throw new Error('Maintenance mode is not currently active.');
      }

      const response = await fetchWithAuth(`/api/maintenance/${action === 'enter' ? 'start' : 'exit'}`, {
        method: 'POST',
      });
      const safeResponse = await ensureOk(response, 'Maintenance action failed');
      const result = await safeResponse.json() as { success: boolean; error?: string; message?: string };
      if (!result.success) {
        throw new Error(result.error || result.message || 'Maintenance action failed');
      }
      return action;
    },
    onMutate: (action) => {
      setPendingAction(action);
      setActionError(null);
      setActionMessage(null);
    },
    onSuccess: async (action) => {
      setActionMessage(action === 'enter' ? 'Maintenance mode enabled' : 'Maintenance mode disabled');
      await Promise.resolve(onRefresh());
      queryClient.removeQueries({ queryKey: ['files'] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : 'Failed to change maintenance mode');
    },
    onSettled: () => {
      setPendingAction(null);
    },
  });

  const handleMaintenanceChange = useCallback((action: 'enter' | 'exit') => {
    maintenanceMutation.mutate(action);
  }, [maintenanceMutation]);

  const actionState: 'idle' | 'entering' | 'exiting' = maintenanceMutation.isPending && pendingAction
    ? pendingAction === 'enter'
      ? 'entering'
      : 'exiting'
    : 'idle';

  const terminalSrc = useMemo(() => '/src/terminal/?embedded=true&default=bash', []);

  return (
    <div style={{ maxWidth: '1600px', margin: '40px auto', padding: '0 20px' }}>
      <div style={{
        background: 'rgba(10, 22, 18, 0.85)',
        border: '1px solid rgba(87, 166, 78, 0.3)',
        borderRadius: '16px',
        padding: '32px',
        boxShadow: '0 15px 45px rgba(0, 0, 0, 0.45)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <h2 style={{
              margin: '0 0 12px',
              color: '#57A64E',
              fontSize: '1.5rem',
              letterSpacing: '0.05em'
            }}>
              Maintenance & Remote Access
            </h2>
            <p style={{
              margin: '0',
              color: 'rgba(224,224,224,0.85)',
              lineHeight: 1.5
            }}>
              Use maintenance mode to safely edit `/data` and manage plugins. Enable SSH access by setting
              `ALLOW_SSH=true` and providing `SSH_AUTHORIZED_KEYS`. Add an SSH service (`ssh://localhost:22`)
              to your Cloudflare Tunnel, then connect with `cloudflared access ssh --hostname &lt;host&gt;`.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '240px' }}>
            <button
              onClick={() => handleMaintenanceChange('enter')}
              disabled={actionState !== 'idle' || serverState !== 'stopped'}
              style={maintenanceButtonStyle(actionState !== 'idle' || serverState !== 'stopped')}
            >
              {actionState === 'entering' ? 'Entering Maintenance…' : 'Enter Maintenance Mode'}
            </button>
            <button
              onClick={() => handleMaintenanceChange('exit')}
              disabled={actionState !== 'idle' || serverState !== 'maintenance'}
              style={maintenanceDangerButtonStyle(actionState !== 'idle' || serverState !== 'maintenance')}
            >
              {actionState === 'exiting' ? 'Exiting Maintenance…' : 'Exit Maintenance Mode'}
            </button>
          </div>
        </div>

        {actionMessage && (
          <div style={statusBoxStyle('#57A64E')}>{actionMessage}</div>
        )}
        {actionError && (
          <div style={statusBoxStyle('#ff6b6b')}>{actionError}</div>
        )}

        <div style={{ marginTop: '30px' }}>
          <h3 style={{ color: '#7cbc73', marginBottom: '12px' }}>Embedded Bash Terminal</h3>
          <iframe
            src={terminalSrc}
            style={{
              width: '100%',
              height: '420px',
              border: '1px solid rgba(87, 166, 78, 0.3)',
              borderRadius: '12px',
              background: '#000'
            }}
          />
          <p style={{ color: 'rgba(224,224,224,0.6)', marginTop: '8px' }}>
            The terminal shares the same session as SSH. Use it for quick edits when maintenance mode is active.
          </p>
        </div>

        <div style={{ marginTop: '32px' }}>
          <FileManager serverState={serverState} />
        </div>
      </div>
    </div>
  );
}

interface FileManagerProps {
  serverState: ServerState;
}

function FileManager({ serverState }: FileManagerProps) {
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState('/data');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canWrite = serverState === 'maintenance';

  const directoryQuery = useQuery<FileListResponse>({
    queryKey: fileListQueryKey(currentPath),
    queryFn: () => getDirectoryListing(currentPath),
    staleTime: 0,
  });

  const listing = directoryQuery.data;
  const entries: FileEntry[] = listing?.entries ?? [];
  const parentPath = listing?.parent;
  const activePath = listing?.path ?? currentPath;
  const directoryError = directoryQuery.error instanceof Error ? directoryQuery.error.message : null;
  const isDirectoryLoading = directoryQuery.isPending || (directoryQuery.isFetching && !listing);

  const fileQueryKey = fileContentQueryKey(editorPath ?? '');
  const fileQuery = useQuery<string>({
    queryKey: fileQueryKey,
    queryFn: () => getFileContents(editorPath ?? ''),
    enabled: Boolean(editorPath),
  });
  const editorLoading = fileQuery.isPending;

  useEffect(() => {
    if (editorPath && fileQuery.data !== undefined) {
      setEditorContent(fileQuery.data);
    }
  }, [editorPath, fileQuery.data]);

  const saveFileMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) => writeFileContents(path, content),
    onMutate: () => setStatusMessage(null),
    onSuccess: async (_, variables) => {
      setStatusMessage('Saved changes');
      await queryClient.invalidateQueries({ queryKey: fileContentQueryKey(variables.path) });
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save file');
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: ({ path, file }: { path: string; file: File }) => writeFileContents(path, file),
    onMutate: ({ file }) => {
      setStatusMessage(`Uploading ${file.name}…`);
    },
    onSuccess: async (_, variables) => {
      setStatusMessage(`Uploaded ${variables.file.name}`);
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to upload file');
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: ({ path }: { path: string }) => createDirectoryRequest(path),
    onSuccess: async (_, variables) => {
      const parts = variables.path.split('/');
      const name = parts[parts.length - 1] || variables.path;
      setStatusMessage(`Created ${name}`);
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to create folder');
    },
  });

  const openFile = useCallback((path: string) => {
    setStatusMessage(null);
    setEditorPath(path);
  }, []);

  const saveFile = useCallback(() => {
    if (!editorPath) return;
    saveFileMutation.mutate({ path: editorPath, content: editorContent });
  }, [editorContent, editorPath, saveFileMutation]);

  const uploadFile = useCallback(async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const targetPath = buildChildPath(activePath, file.name);
    try {
      await uploadFileMutation.mutateAsync({ path: targetPath, file });
    } finally {
      input.value = '';
    }
  }, [activePath, uploadFileMutation]);

  const downloadFile = useCallback(async (entry: FileEntry) => {
    try {
      const response = await fetchWithAuth(`/api/files/file?path=${encodeURIComponent(entry.path)}`);
      const safeResponse = await ensureOk(response, 'Failed to download file');
      const blob = await safeResponse.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = entry.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to download file');
    }
  }, []);

  const createFolder = useCallback(() => {
    const name = prompt('Folder name');
    if (!name) return;
    const targetPath = buildChildPath(activePath, name);
    createFolderMutation.mutate({ path: targetPath });
  }, [activePath, createFolderMutation]);

  const refreshDirectory = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: fileListQueryKey(activePath) });
  }, [activePath, queryClient]);

  return (
    <div style={{
      background: 'rgba(12, 24, 20, 0.8)',
      border: '1px solid rgba(87, 166, 78, 0.2)',
      borderRadius: '12px',
      padding: '24px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ color: '#7cbc73', margin: '0 0 4px' }}>File Manager</h3>
          <div style={{ color: 'rgba(224,224,224,0.7)', fontSize: '0.9rem' }}>Current path: {activePath}</div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={() => parentPath && setCurrentPath(parentPath)}
            disabled={!parentPath}
            style={secondaryButtonStyle(!parentPath)}
          >
            Go Up
          </button>
          <button
            onClick={refreshDirectory}
            style={secondaryButtonStyle(false)}
          >
            Refresh
          </button>
          <button
            onClick={createFolder}
            disabled={!canWrite}
            style={maintenanceButtonStyle(!canWrite)}
          >
            New Folder
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!canWrite}
            style={maintenanceButtonStyle(!canWrite)}
          >
            Upload File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={uploadFile}
          />
        </div>
      </div>

      {directoryError && <div style={statusBoxStyle('#ff6b6b')}>{directoryError}</div>}
      {statusMessage && <div style={statusBoxStyle('#57A64E')}>{statusMessage}</div>}

      <div style={{ marginTop: '20px' }}>
        {isDirectoryLoading ? (
          <div style={{ color: 'rgba(224,224,224,0.7)' }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {entries.length === 0 && (
              <div style={{ color: 'rgba(224,224,224,0.6)', fontStyle: 'italic' }}>This directory is empty.</div>
            )}
            {entries.map(entry => (
              <div
                key={entry.path}
                onClick={() => entry.type === 'directory' ? setCurrentPath(entry.path) : openFile(entry.path)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  border: '1px solid rgba(87, 166, 78, 0.2)',
                  borderRadius: '10px',
                  background: 'rgba(15, 30, 25, 0.8)',
                  cursor: 'pointer'
                }}
              >
                <div>
                  <div style={{ color: '#fff', fontWeight: 600 }}>{entry.name}</div>
                  <div style={{ color: 'rgba(224,224,224,0.6)', fontSize: '0.85rem' }}>
                    {entry.type === 'directory' ? 'Directory' : formatSize(entry.size)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {entry.type === 'file' && (
                    <button
                      onClick={(evt) => {
                        evt.stopPropagation();
                        downloadFile(entry);
                      }}
                      style={secondaryButtonStyle(false)}
                    >
                      Download
                    </button>
                  )}
                  {entry.type === 'file' && (
                    <button
                      onClick={(evt) => {
                        evt.stopPropagation();
                        openFile(entry.path);
                      }}
                      style={maintenanceButtonStyle(!canWrite)}
                      disabled={!canWrite}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editorPath && (
        <div style={{ marginTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ color: '#7cbc73', margin: 0 }}>Editing {editorPath}</h4>
            <button
              onClick={() => setEditorPath(null)}
              style={secondaryButtonStyle(false)}
            >
              Close
            </button>
          </div>
          <textarea
            value={editorContent}
            onInput={(event) => setEditorContent((event.currentTarget as HTMLTextAreaElement).value)}
            disabled={editorLoading}
            style={{
              width: '100%',
              minHeight: '220px',
              marginTop: '12px',
              background: '#0a1612',
              color: '#e0e0e0',
              border: '1px solid rgba(87,166,78,0.4)',
              borderRadius: '8px',
              padding: '12px',
              fontFamily: '"Fira Code", mono'
            }}
          />
          <button
            onClick={saveFile}
            disabled={!canWrite || saveFileMutation.isPending}
            style={{ ...maintenanceButtonStyle(!canWrite || saveFileMutation.isPending), marginTop: '12px' }}
          >
            {saveFileMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}

function buildChildPath(basePath: string, leaf: string) {
  const safeLeaf = leaf.startsWith('/') ? leaf.slice(1) : leaf;
  if (!basePath || basePath === '/') {
    return `/${safeLeaf}`;
  }
  const trimmedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${trimmedBase}/${safeLeaf}`;
}

const maintenanceButtonStyle = (disabled: boolean) => ({
  background: disabled ? 'rgba(87,166,78,0.25)' : 'linear-gradient(135deg, #55FF55 0%, #57A64E 100%)',
  color: disabled ? 'rgba(10,22,18,0.6)' : '#0a1612',
  border: 'none',
  borderRadius: '10px',
  padding: '10px 16px',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const maintenanceDangerButtonStyle = (disabled: boolean) => ({
  background: disabled ? 'rgba(255,107,107,0.25)' : 'linear-gradient(135deg, #ff8a8a 0%, #ff6b6b 100%)',
  color: '#0a1612',
  border: 'none',
  borderRadius: '10px',
  padding: '10px 16px',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const secondaryButtonStyle = (disabled: boolean) => ({
  background: 'rgba(87,166,78,0.15)',
  color: '#57A64E',
  border: '1px solid rgba(87,166,78,0.3)',
  borderRadius: '10px',
  padding: '10px 14px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});

const statusBoxStyle = (color: string) => ({
  marginTop: '16px',
  padding: '12px 16px',
  borderRadius: '10px',
  border: `1px solid ${color}55`,
  color,
  background: 'rgba(0,0,0,0.3)'
});

function formatSize(size: number | null): string {
  if (size === null) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
