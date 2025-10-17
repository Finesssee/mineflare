import { h } from 'preact';
import { useToolOutput, useTheme } from '../shared/useOpenAiGlobal';

interface ServerStatus {
  online: boolean;
  playerCount?: number;
  maxPlayers?: number;
}

interface Player {
  name: string;
  uuid: string;
}

interface SessionInfo {
  isRunning: boolean;
  startTime?: number;
  duration?: number;
}

interface ServerOverviewData {
  status: ServerStatus;
  players: Player[];
  serverState: 'stopped' | 'starting' | 'running' | 'stopping';
  startupStep?: string;
  sessionInfo?: SessionInfo;
}

export function ServerOverview() {
  const data = useToolOutput<ServerOverviewData>();
  const theme = useTheme();

  if (!data) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>;
  }

  const { status, players, serverState, startupStep, sessionInfo } = data;
  const isDark = theme === 'dark';

  const getStatusColor = () => {
    if (serverState === 'running' && status.online) return '#55FF55';
    if (serverState === 'starting') return '#FFB600';
    if (serverState === 'stopping') return '#ff6b6b';
    return '#888';
  };

  const getStatusText = () => {
    if (serverState === 'starting') return 'Starting...';
    if (serverState === 'stopping') return 'Stopping...';
    if (status.online) return 'Online';
    return 'Offline';
  };

  const handleAction = (action: string) => {
    window.openai?.sendFollowUpMessage?.({ 
      prompt: action 
    });
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: isDark ? '#1a1a1a' : '#ffffff',
      color: isDark ? '#e0e0e0' : '#1a1a1a',
      border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
      borderRadius: '16px',
      padding: '20px',
      maxWidth: '500px',
    }}>
      {/* Status Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '16px',
        paddingBottom: '16px',
        borderBottom: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
      }}>
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: getStatusColor(),
          boxShadow: `0 0 8px ${getStatusColor()}`,
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '18px', fontWeight: '600' }}>
            Minecraft Server
          </div>
          <div style={{ 
            fontSize: '14px', 
            color: getStatusColor(),
            fontWeight: '500',
          }}>
            {getStatusText()}
          </div>
        </div>
      </div>

      {/* Startup Progress */}
      {serverState === 'starting' && startupStep && (
        <div style={{
          marginBottom: '16px',
          padding: '12px',
          background: isDark ? 'rgba(255, 182, 0, 0.1)' : 'rgba(255, 182, 0, 0.05)',
          border: `1px solid ${isDark ? 'rgba(255, 182, 0, 0.3)' : 'rgba(255, 182, 0, 0.2)'}`,
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '13px', color: '#FFB600', marginBottom: '8px' }}>
            ⏳ {startupStep}
          </div>
          <div style={{
            width: '100%',
            height: '4px',
            background: isDark ? 'rgba(255, 182, 0, 0.2)' : 'rgba(255, 182, 0, 0.15)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: '60%',
              height: '100%',
              background: '#FFB600',
              animation: 'progress 2s ease-in-out infinite',
            }} />
          </div>
          <style>{`
            @keyframes progress {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(250%); }
            }
          `}</style>
        </div>
      )}

      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '12px',
        marginBottom: '16px',
      }}>
        <div style={{
          padding: '12px',
          background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', color: isDark ? '#888' : '#666', marginBottom: '4px' }}>
            Players Online
          </div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#FFB600' }}>
            {status.playerCount ?? 0}
          </div>
        </div>

        <div style={{
          padding: '12px',
          background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', color: isDark ? '#888' : '#666', marginBottom: '4px' }}>
            Max Players
          </div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#57A64E' }}>
            {status.maxPlayers ?? 20}
          </div>
        </div>
      </div>

      {/* Session Info */}
      {sessionInfo?.isRunning && sessionInfo.duration && (
        <div style={{
          padding: '12px',
          background: isDark ? 'rgba(87, 166, 78, 0.1)' : 'rgba(87, 166, 78, 0.05)',
          border: `1px solid ${isDark ? 'rgba(87, 166, 78, 0.3)' : 'rgba(87, 166, 78, 0.2)'}`,
          borderRadius: '8px',
          marginBottom: '16px',
        }}>
          <div style={{ fontSize: '12px', color: isDark ? '#888' : '#666', marginBottom: '4px' }}>
            Session Duration
          </div>
          <div style={{ fontSize: '16px', fontWeight: '600', color: '#57A64E' }}>
            {formatDuration(sessionInfo.duration)}
          </div>
        </div>
      )}

      {/* Players List */}
      {players.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: isDark ? '#888' : '#666', marginBottom: '8px' }}>
            Online Players
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {players.slice(0, 5).map((player) => (
              <div key={player.uuid} style={{
                padding: '8px 12px',
                background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
                borderRadius: '6px',
                fontSize: '14px',
              }}>
                {player.name}
              </div>
            ))}
            {players.length > 5 && (
              <div style={{ fontSize: '12px', color: isDark ? '#888' : '#666', padding: '4px 12px' }}>
                +{players.length - 5} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {serverState === 'stopped' && (
          <button
            onClick={() => handleAction('start my server')}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: 'linear-gradient(135deg, #55FF55 0%, #57A64E 100%)',
              color: '#0a1612',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'transform 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            ▶ Start Server
          </button>
        )}
        {(serverState === 'running' || serverState === 'starting') && (
          <button
            onClick={() => handleAction('stop my server')}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: isDark ? 'rgba(255, 107, 107, 0.15)' : 'rgba(255, 107, 107, 0.1)',
              color: '#ff6b6b',
              border: `1px solid ${isDark ? 'rgba(255, 107, 107, 0.3)' : 'rgba(255, 107, 107, 0.2)'}`,
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'transform 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255, 107, 107, 0.25)' : 'rgba(255, 107, 107, 0.15)';
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = isDark ? 'rgba(255, 107, 107, 0.15)' : 'rgba(255, 107, 107, 0.1)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            ⏹ Stop Server
          </button>
        )}
      </div>
    </div>
  );
}








