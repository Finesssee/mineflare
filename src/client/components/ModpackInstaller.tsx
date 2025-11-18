import { useEffect, useState, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { ServerState } from '../types/api';
import { fetchApi } from '../utils/api';

type ModpackSource = 'modrinth' | 'curseforge';

interface ModpackProgress {
  phase: string;
  currentFile?: string;
  currentIndex?: number;
  totalFiles?: number;
  note?: string;
}

interface ModpackJobResult {
  loader?: string;
  minecraftVersion?: string;
  profileSuggestion?: string;
  packName?: string;
  filesInstalled?: number;
  overridesApplied?: boolean;
  metadata?: Record<string, unknown>;
}

interface ModpackJob {
  id: string;
  source: ModpackSource;
  status: 'pending' | 'downloading' | 'installing' | 'completed' | 'failed';
  progress?: ModpackProgress;
  result?: ModpackJobResult;
  error?: string;
}

interface ModpackInstallerProps {
  serverState: ServerState;
}

const STORAGE_KEY = 'mineflare-modpack-job';

export function ModpackInstaller({ serverState }: ModpackInstallerProps) {
  const [modrinthUrl, setModrinthUrl] = useState('');
  const [modrinthVersion, setModrinthVersion] = useState('');
  const [curseProjectId, setCurseProjectId] = useState('');
  const [curseFileId, setCurseFileId] = useState('');
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ModpackJob | null>(null);
  const [installing, setInstalling] = useState<ModpackSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimeout = useRef<number | null>(null);

  const clearPoll = () => {
    if (pollTimeout.current) {
      clearTimeout(pollTimeout.current);
      pollTimeout.current = null;
    }
  };

  const schedulePoll = (jobId: string) => {
    clearPoll();
    pollTimeout.current = window.setTimeout(() => pollStatus(jobId), 3500);
  };

  const updateJobState = (jobId: string, data: ModpackJob) => {
    setCurrentJobId(jobId);
    setJob(data);
    if (data.status === 'completed' || data.status === 'failed') {
      clearPoll();
      localStorage.removeItem(STORAGE_KEY);
      setInstalling(null);
      if (serverState === 'maintenance') {
        // Container will exit maintenance automatically once install completes
      }
    } else {
      schedulePoll(jobId);
    }
  };

  const pollStatus = async (jobId: string) => {
    try {
      const response = await fetchApi(`/api/modpack/status/${jobId}`);
      if (response.status === 404) {
        clearPoll();
        localStorage.removeItem(STORAGE_KEY);
        setInstalling(null);
        setCurrentJobId(null);
        setJob(null);
        return;
      }
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = await response.json() as ModpackJob;
      updateJobState(jobId, data);
    } catch (err) {
      console.error('Failed to poll modpack status:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch modpack status');
      clearPoll();
    }
  };

  const beginTracking = (jobId: string) => {
    setCurrentJobId(jobId);
    localStorage.setItem(STORAGE_KEY, jobId);
    setJob(null);
    pollStatus(jobId);
  };

  const startInstall = async (payload: { source: ModpackSource; url?: string; packVersion?: string; projectId?: number; fileId?: number }) => {
    if (serverState !== 'stopped') {
      setError('Stop the server before installing a modpack.');
      return;
    }
    setError(null);
    setInstalling(payload.source);
    try {
      const response = await fetchApi('/api/modpack/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = await response.json() as { success: boolean; jobId?: string; error?: string };
      if (!result.success || !result.jobId) {
        throw new Error(result.error || 'Failed to start modpack installation');
      }
      beginTracking(result.jobId);
    } catch (err) {
      console.error('Failed to start modpack install:', err);
      setError(err instanceof Error ? err.message : 'Failed to start modpack installation');
      setInstalling(null);
    }
  };

  const handleModrinthInstall = () => {
    const url = modrinthUrl.trim();
    if (!url) {
      setError('Enter a Modrinth pack URL');
      return;
    }
    startInstall({ source: 'modrinth', url, packVersion: modrinthVersion.trim() || undefined });
  };

  const handleCurseforgeInstall = () => {
    const projectId = Number(curseProjectId);
    const fileId = Number(curseFileId);
    if (!projectId || !fileId) {
      setError('Enter both CurseForge project ID and file ID');
      return;
    }
    startInstall({ source: 'curseforge', projectId, fileId });
  };

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setCurrentJobId(stored);
      pollStatus(stored);
    }
    return () => clearPoll();
  }, []);

  const jobActive = Boolean(currentJobId && job && job.status !== 'completed' && job.status !== 'failed');
  const disableInputs = installing !== null || jobActive || serverState !== 'stopped';

  const renderJobStatus = () => {
    if (!job || !currentJobId) return null;

    const statusColors: Record<ModpackJob['status'], string> = {
      pending: '#57A64E',
      downloading: '#F7B733',
      installing: '#F7B733',
      completed: '#57A64E',
      failed: '#ff6b6b',
    };

    const statusLabel = job.status.charAt(0).toUpperCase() + job.status.slice(1);

    return (
      <div style={{
        marginTop: '16px',
        padding: '20px',
        borderRadius: '14px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'linear-gradient(135deg, rgba(32, 48, 32, 0.65), rgba(20, 24, 16, 0.85))',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}>
          <div>
            <div style={{
              fontSize: '0.85rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#aaa',
            }}>
              Installation Status · {job.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
            </div>
            <div style={{
              marginTop: '6px',
              fontSize: '1.5rem',
              fontWeight: 700,
              color: statusColors[job.status],
            }}>
              {statusLabel}
            </div>
          </div>
          <div style={{
            fontSize: '0.9rem',
            color: '#bbb',
          }}>
            Job ID: {currentJobId}
          </div>
        </div>

        {job.progress && (
          <div style={{
            marginBottom: '12px',
            fontSize: '1rem',
            color: '#e0e0e0',
          }}>
            {job.progress.phase}
            {job.progress.currentFile && (
              <span style={{ color: '#aaa' }}>
                {' '}· {job.progress.currentFile}
              </span>
            )}
            {job.progress.currentIndex && job.progress.totalFiles && (
              <span style={{ color: '#aaa' }}>
                {' '}({job.progress.currentIndex}/{job.progress.totalFiles})
              </span>
            )}
          </div>
        )}

        {job.result && job.status === 'completed' && (
          <div style={{
            marginTop: '12px',
            padding: '16px',
            borderRadius: '12px',
            background: 'rgba(12, 24, 12, 0.7)',
            border: '1px solid rgba(87, 166, 78, 0.3)',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '8px', color: '#57A64E' }}>
              {job.result.packName || 'Modpack ready'}
            </div>
            <div style={{ color: '#ccc', fontSize: '0.95rem', lineHeight: 1.5 }}>
              {job.result.filesInstalled !== undefined && (
                <div>{job.result.filesInstalled} mods installed {job.result.overridesApplied ? 'with overrides applied.' : ''}</div>
              )}
              {job.result.loader && job.result.minecraftVersion && (
                <div>
                  Loader: {job.result.loader} · Minecraft {job.result.minecraftVersion}
                </div>
              )}
              {job.result.profileSuggestion && (
                <div>
                  Recommended profile: <strong>{job.result.profileSuggestion}</strong> (select it in the Version card before starting the server).
                </div>
              )}
              <div style={{ marginTop: '8px' }}>
                A fresh backup has been created—start the server when you’re ready.
              </div>
            </div>
          </div>
        )}

        {job.status === 'failed' && (
          <div style={{
            marginTop: '12px',
            padding: '14px',
            borderRadius: '10px',
            background: 'rgba(255, 71, 71, 0.08)',
            border: '1px solid rgba(255, 71, 71, 0.3)',
            color: '#ff8484',
          }}>
            Installation failed: {job.error || 'Check the worker logs for more details.'}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(14, 20, 14, 0.95), rgba(18, 10, 10, 0.9))',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '18px',
      padding: '24px',
      boxShadow: '0 15px 35px rgba(0,0,0,0.4)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
      }}>
        <div>
          <h2 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#f2f2f2',
          }}>
            Modpack Installer
          </h2>
          <p style={{
            margin: '6px 0 0',
            color: '#bbb',
            fontSize: '0.95rem',
          }}>
            Stop the server to install a Modrinth or CurseForge pack. The container enters maintenance mode while downloading mods.
          </p>
        </div>
      </div>

      {serverState === 'maintenance' && (
        <div style={{
          marginBottom: '16px',
          padding: '14px 16px',
          borderRadius: '12px',
          border: '1px solid rgba(87, 166, 78, 0.35)',
          background: 'rgba(87, 166, 78, 0.12)',
          color: '#b6ffb3',
          fontSize: '0.95rem',
        }}>
          Maintenance mode is active while mods are being installed. The server will restart normally after installation finishes.
        </div>
      )}

      {error && (
        <div style={{
          marginBottom: '16px',
          padding: '12px 14px',
          borderRadius: '10px',
          border: '1px solid rgba(255, 71, 71, 0.3)',
          background: 'rgba(255, 71, 71, 0.08)',
          color: '#ff8484',
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '18px',
      }}>
        <div style={{
          borderRadius: '14px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(20, 24, 18, 0.8)',
          padding: '20px',
        }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '12px', color: '#57A64E' }}>Modrinth</div>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#bbb', marginBottom: '6px' }}>Pack URL</label>
          <input
            type="text"
            value={modrinthUrl}
            onInput={(e) => setModrinthUrl(e.currentTarget.value)}
            placeholder="https://modrinth.com/modpack/..."
            disabled={disableInputs}
            style={inputStyle}
          />
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#bbb', margin: '12px 0 6px' }}>Version ID (optional)</label>
          <input
            type="text"
            value={modrinthVersion}
            onInput={(e) => setModrinthVersion(e.currentTarget.value)}
            placeholder="e.g. ftvO98bS"
            disabled={disableInputs}
            style={inputStyle}
          />
          <button
            onClick={handleModrinthInstall}
            disabled={disableInputs}
            style={buttonStyle(disableInputs || installing === 'curseforge')}
          >
            {installing === 'modrinth' ? 'Starting…' : 'Install from Modrinth'}
          </button>
        </div>

        <div style={{
          borderRadius: '14px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(24, 18, 20, 0.8)',
          padding: '20px',
        }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '12px', color: '#F7B733' }}>CurseForge</div>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#bbb', marginBottom: '6px' }}>Project ID</label>
          <input
            type="number"
            value={curseProjectId}
            onInput={(e) => setCurseProjectId(e.currentTarget.value)}
            placeholder="e.g. 238222"
            disabled={disableInputs}
            style={inputStyle}
          />
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#bbb', margin: '12px 0 6px' }}>File ID</label>
          <input
            type="number"
            value={curseFileId}
            onInput={(e) => setCurseFileId(e.currentTarget.value)}
            placeholder="e.g. 5239222"
            disabled={disableInputs}
            style={inputStyle}
          />
          <button
            onClick={handleCurseforgeInstall}
            disabled={disableInputs}
            style={buttonStyle(disableInputs || installing === 'modrinth')}
          >
            {installing === 'curseforge' ? 'Starting…' : 'Install from CurseForge'}
          </button>
        </div>
      </div>

      {serverState !== 'stopped' && serverState !== 'maintenance' && (
        <div style={{
          marginTop: '16px',
          padding: '12px 14px',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.03)',
          color: '#ccc',
          fontSize: '0.9rem',
        }}>
          Stop the server before installing a new modpack.
        </div>
      )}

      {renderJobStatus()}
    </div>
  );
}

const inputStyle: JSX.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '10px',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  background: 'rgba(0,0,0,0.4)',
  color: '#f2f2f2',
  outline: 'none',
  fontSize: '0.95rem',
};

const buttonStyle = (disabled: boolean): JSX.CSSProperties => ({
  width: '100%',
  marginTop: '16px',
  padding: '12px 18px',
  borderRadius: '10px',
  border: 'none',
  background: disabled ? 'rgba(255, 255, 255, 0.1)' : 'linear-gradient(135deg, #57A64E, #5B9BD5)',
  color: disabled ? '#999' : '#0b1411',
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'transform 0.2s ease',
});
