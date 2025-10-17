import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useToolOutput, useTheme } from '../shared/useOpenAiGlobal';

interface SessionData {
  startTime?: number;
  stopTime?: number;
  duration?: number;
}

interface ServerActionData {
  success: boolean;
  serverState?: 'stopped' | 'starting' | 'running' | 'stopping';
  message?: string;
  lastSession?: SessionData;
  action?: 'start' | 'stop';
  progress?: number;
}

export function ServerAction() {
  const data = useToolOutput<ServerActionData>();
  const theme = useTheme();
  const [dots, setDots] = useState('');

  // Animate loading dots
  useEffect(() => {
    if (data?.serverState === 'starting' || data?.serverState === 'stopping') {
      const interval = setInterval(() => {
        setDots(prev => prev.length >= 3 ? '' : prev + '.');
      }, 500);
      return () => clearInterval(interval);
    }
  }, [data?.serverState]);

  if (!data) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Processing...</div>;
  }

  const { success, serverState, message, lastSession, action } = data;
  const isDark = theme === 'dark';
  const isStarting = serverState === 'starting';
  const isStopping = serverState === 'stopping';
  const isInProgress = isStarting || isStopping;

  const getActionColor = () => {
    if (action === 'start' || isStarting) return '#57A64E';
    if (action === 'stop' || isStopping) return '#ff6b6b';
    if (success) return '#57A64E';
    return '#888';
  };

  const getActionIcon = () => {
    if (isStarting) return '⏳';
    if (isStopping) return '⏹';
    if (action === 'start') return '▶';
    if (action === 'stop') return '⏹';
    if (success) return '✓';
    return '⚠️';
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ${minutes % 60} minute${minutes % 60 !== 1 ? 's' : ''}`;
    }
    if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''} ${seconds % 60} second${seconds % 60 !== 1 ? 's' : ''}`;
    }
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  };

  const handleAction = (actionText: string) => {
    window.openai?.sendFollowUpMessage?.({ prompt: actionText });
  };

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: isDark ? '#1a1a1a' : '#ffffff',
      color: isDark ? '#e0e0e0' : '#1a1a1a',
      border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
      borderRadius: '16px',
      padding: '24px',
      maxWidth: '500px',
    }}>
      {/* Status Icon */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '20px',
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: isInProgress 
            ? `radial-gradient(circle, ${getActionColor()}22, transparent)`
            : `${getActionColor()}15`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '40px',
          border: `2px solid ${getActionColor()}`,
          animation: isInProgress ? 'pulse 2s ease-in-out infinite' : 'none',
        }}>
          {getActionIcon()}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
      `}</style>

      {/* Message */}
      <div style={{
        textAlign: 'center',
        marginBottom: '20px',
      }}>
        <div style={{
          fontSize: '20px',
          fontWeight: '600',
          color: getActionColor(),
          marginBottom: '8px',
        }}>
          {isStarting && `Starting Server${dots}`}
          {isStopping && `Stopping Server${dots}`}
          {!isInProgress && success && action === 'start' && 'Server Started'}
          {!isInProgress && success && action === 'stop' && 'Server Stopped'}
          {!isInProgress && !success && 'Action Failed'}
        </div>

        {message && (
          <div style={{
            fontSize: '14px',
            color: isDark ? '#888' : '#666',
            lineHeight: '1.5',
          }}>
            {message}
          </div>
        )}

        {isStarting && (
          <div style={{
            fontSize: '13px',
            color: isDark ? '#888' : '#666',
            marginTop: '8px',
          }}>
            This may take up to 5 minutes
          </div>
        )}

        {isStopping && (
          <div style={{
            fontSize: '13px',
            color: isDark ? '#888' : '#666',
            marginTop: '8px',
          }}>
            Backing up your world data safely...
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {isInProgress && (
        <div style={{
          width: '100%',
          height: '6px',
          background: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          borderRadius: '3px',
          overflow: 'hidden',
          marginBottom: '20px',
        }}>
          <div style={{
            height: '100%',
            width: '100%',
            background: getActionColor(),
            borderRadius: '3px',
            animation: 'loading 2s ease-in-out infinite',
          }} />
        </div>
      )}

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>

      {/* Session Summary (for stop action) */}
      {action === 'stop' && lastSession && lastSession.duration && (
        <div style={{
          padding: '16px',
          background: isDark ? 'rgba(87, 166, 78, 0.1)' : 'rgba(87, 166, 78, 0.05)',
          border: `1px solid ${isDark ? 'rgba(87, 166, 78, 0.3)' : 'rgba(87, 166, 78, 0.2)'}`,
          borderRadius: '12px',
          marginBottom: '16px',
        }}>
          <div style={{
            fontSize: '13px',
            color: isDark ? '#888' : '#666',
            marginBottom: '8px',
            textAlign: 'center',
          }}>
            Session Duration
          </div>
          <div style={{
            fontSize: '18px',
            fontWeight: '600',
            color: '#57A64E',
            textAlign: 'center',
          }}>
            {formatDuration(lastSession.duration)}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {!isInProgress && success && (
        <div style={{
          display: 'flex',
          gap: '8px',
          justifyContent: 'center',
        }}>
          {action === 'start' && (
            <>
              <button
                onClick={() => handleAction('show me the map')}
                style={{
                  padding: '10px 20px',
                  background: isDark ? 'rgba(87, 166, 78, 0.15)' : 'rgba(87, 166, 78, 0.1)',
                  color: '#57A64E',
                  border: `1px solid ${isDark ? 'rgba(87, 166, 78, 0.3)' : 'rgba(87, 166, 78, 0.2)'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = isDark ? 'rgba(87, 166, 78, 0.25)' : 'rgba(87, 166, 78, 0.15)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = isDark ? 'rgba(87, 166, 78, 0.15)' : 'rgba(87, 166, 78, 0.1)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                🗺️ View Map
              </button>
              <button
                onClick={() => handleAction('open the terminal')}
                style={{
                  padding: '10px 20px',
                  background: isDark ? 'rgba(87, 166, 78, 0.15)' : 'rgba(87, 166, 78, 0.1)',
                  color: '#57A64E',
                  border: `1px solid ${isDark ? 'rgba(87, 166, 78, 0.3)' : 'rgba(87, 166, 78, 0.2)'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = isDark ? 'rgba(87, 166, 78, 0.25)' : 'rgba(87, 166, 78, 0.15)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = isDark ? 'rgba(87, 166, 78, 0.15)' : 'rgba(87, 166, 78, 0.1)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                🖥️ Terminal
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}









