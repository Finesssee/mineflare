import { ServerStatus } from './components/ServerStatus';
import { PlayerList } from './components/PlayerList';
import { useServerData } from './hooks/useServerData';
import { Terminal } from './components/Terminal';
import { Minimap } from './components/Minimap';
import { Plugins } from './components/Plugins';
import { Login } from './components/Login';
import { useAuth } from './hooks/useAuth';
import { SessionTimer } from './components/SessionTimer';
import { VersionSelector } from './components/VersionSelector';
import logo from '../../dist/client/mineflare-logo.png';

try {
  if (process.env.NODE_ENV === 'development') {
    import.meta.hot.accept();
  }
} catch (error) {
  // ignore
}

export function App() {
  const auth = useAuth();
  
  // Check for debug mode
  const isDebugMode = new URLSearchParams(window.location.search).get('debug') === 'true';
  
  // Only start polling server data when authenticated
  const { status, players, info, plugins, loading, error, serverState, startupStep, serverVersion, supportedVersions, canChangeVersion, startServer, stopServer, refresh, togglePlugin, updateVersion } = useServerData(auth.authenticated);

  // Show login overlay if not authenticated
  if (!auth.authenticated) {
    return (
      <Login
        passwordSet={auth.passwordSet}
        onSetup={auth.setup}
        onLogin={auth.login}
        loading={auth.loading}
      />
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a1612 0%, #1a2e1e 50%, #2a1810 100%)',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#e0e0e0',
      padding: '0',
      margin: '0',
    }}>
      {/* Hero Section */}
      <div style={{
        maxWidth: '1600px',
        margin: '0 auto',
        padding: '60px 20px 40px',
        textAlign: 'center',
        position: 'relative',
      }}>
        <img 
          src={logo}
          alt="Mineflare" 
          style={{
            maxHeight: '160px',
            maxWidth: '80%',
            objectFit: 'contain',
            filter: 'drop-shadow(0 4px 12px rgba(87, 166, 78, 0.3))',
            margin: '0 0 20px 0',
          }}
        />
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          marginBottom: '30px',
          flexWrap: 'wrap',
        }}>
          
          {serverState === 'running' && (
            <button 
              onClick={refresh} 
              disabled={loading}
              title={loading ? "Refreshing..." : "Refresh now"}
              style={{
                width: '32px',
                height: '32px',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.125rem',
                background: 'rgba(87, 166, 78, 0.15)',
                color: loading ? '#7cbc73' : '#57A64E',
                border: '1px solid rgba(87, 166, 78, 0.3)',
                borderRadius: '50%',
                cursor: loading ? 'default' : 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                animation: loading ? 'spin 2s cubic-bezier(0.4, 0, 0.2, 1) infinite' : 'none',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'rgba(87, 166, 78, 0.25)';
                  e.currentTarget.style.borderColor = 'rgba(87, 166, 78, 0.5)';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'rgba(87, 166, 78, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(87, 166, 78, 0.3)';
                  e.currentTarget.style.transform = 'scale(1)';
                }
              }}
            >
              ↻
            </button>
          )}
        </div>
        
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
        
        {error && (
          <div style={{
            marginTop: '20px',
            padding: '16px 20px',
            background: 'rgba(255, 71, 71, 0.1)',
            border: '1px solid rgba(255, 71, 71, 0.3)',
            borderRadius: '8px',
            color: '#ff6b6b',
            fontWeight: '500',
          }}>
            ⚠️ Error: {error}
          </div>
        )}

        {/* Start/Stop Button */}
        {!serverState ? (
          <div style={{
            marginTop: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
          }}>
            <div style={{
              fontSize: 'clamp(1.125rem, 2.5vw, 1.5rem)',
              fontWeight: '700',
              padding: 'clamp(16px, 3vw, 24px) clamp(48px, 8vw, 80px)',
              background: 'rgba(87, 166, 78, 0.15)',
              color: '#57A64E',
              border: '2px solid rgba(87, 166, 78, 0.3)',
              borderRadius: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              animation: 'pulse 2s ease-in-out infinite',
            }}>
              ⏳ Initializing...
            </div>
            <p style={{
              fontSize: '0.9rem',
              color: '#888',
              margin: '0',
              textAlign: 'center',
            }}>
              Loading server state
            </p>
          </div>
        ) : serverState === 'stopped' ? (
          <div style={{
            marginTop: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
          }}>
            <button
              onClick={startServer}
              disabled={loading}
              style={{
                fontSize: 'clamp(1.125rem, 2.5vw, 1.5rem)',
                fontWeight: '700',
                padding: 'clamp(16px, 3vw, 24px) clamp(48px, 8vw, 80px)',
                background: loading ? 'rgba(87, 166, 78, 0.5)' : 'linear-gradient(135deg, #55FF55 0%, #57A64E 100%)',
                color: '#0a1612',
                border: 'none',
                borderRadius: '12px',
                cursor: loading ? 'default' : 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 8px 32px rgba(85, 255, 85, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                opacity: loading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                  e.currentTarget.style.boxShadow = '0 12px 48px rgba(85, 255, 85, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.2)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.currentTarget.style.transform = 'translateY(0) scale(1)';
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(85, 255, 85, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1)';
                }
              }}
            >
              ▶ Start Server
            </button>
            <p style={{
              fontSize: '0.9rem',
              color: '#888',
              margin: '0',
              textAlign: 'center',
            }}>
              Click to start the Minecraft server
            </p>
          </div>
        ) : serverState === 'starting' ? (
          <div style={{
            marginTop: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
          }}>
            <div style={{
              fontSize: 'clamp(1.125rem, 2.5vw, 1.5rem)',
              fontWeight: '700',
              padding: 'clamp(16px, 3vw, 24px) clamp(48px, 8vw, 80px)',
              background: 'rgba(255, 182, 0, 0.15)',
              color: '#FFB600',
              border: '2px solid rgba(255, 182, 0, 0.3)',
              borderRadius: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              animation: 'pulse 2s ease-in-out infinite',
            }}>
              ⏳ Starting Server...
            </div>
            <p style={{
              fontSize: '0.9rem',
              color: '#888',
              margin: '0',
              textAlign: 'center',
            }}>
              This may take up to 5 minutes
            </p>
          </div>
        ) : serverState === 'stopping' ? (
          <div style={{
            marginTop: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
          }}>
            <div style={{
              fontSize: 'clamp(1.125rem, 2.5vw, 1.5rem)',
              fontWeight: '700',
              padding: 'clamp(16px, 3vw, 24px) clamp(48px, 8vw, 80px)',
              background: 'rgba(255, 107, 107, 0.15)',
              color: '#ff6b6b',
              border: '2px solid rgba(255, 107, 107, 0.3)',
              borderRadius: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              animation: 'pulse 2s ease-in-out infinite',
            }}>
              ⏹ Stopping Server...
            </div>
            <p style={{
              fontSize: '0.9rem',
              color: '#888',
              margin: '0',
              textAlign: 'center',
            }}>
              Storing your world data & plugin configurations safely
            </p>
          </div>
        ) : null}
        
        {/* Terminal and Stop buttons - show when running, starting, or in debug mode */}
        {(serverState === 'running' || serverState === 'starting' || isDebugMode) && (
          <div style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 10,
            display: 'flex',
            gap: '12px',
          }}>
            <button
              onClick={() => window.open('/src/terminal', '_blank')}
              style={{
                fontSize: '0.875rem',
                fontWeight: '600',
                padding: '8px 20px',
                background: 'rgba(87, 166, 78, 0.15)',
                color: '#57A64E',
                border: '1px solid rgba(87, 166, 78, 0.3)',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(87, 166, 78, 0.25)';
                e.currentTarget.style.borderColor = 'rgba(87, 166, 78, 0.5)';
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(87, 166, 78, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(87, 166, 78, 0.3)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              🖥️ Terminal
            </button>
            <button
              onClick={stopServer}
              disabled={isDebugMode ? false : (serverState === 'starting' ? false : loading)}
              style={{
                fontSize: '0.875rem',
                fontWeight: '600',
                padding: '8px 20px',
                background: (isDebugMode || serverState === 'starting' || !loading) ? 'rgba(255, 107, 107, 0.15)' : 'rgba(255, 107, 107, 0.1)',
                color: '#ff6b6b',
                border: '1px solid rgba(255, 107, 107, 0.3)',
                borderRadius: '8px',
                cursor: (isDebugMode || serverState === 'starting' || !loading) ? 'pointer' : 'default',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                opacity: (isDebugMode || serverState === 'starting' || !loading) ? 1 : 0.6,
              }}
              onMouseEnter={(e) => {
                if (isDebugMode || serverState === 'starting' || !loading) {
                  e.currentTarget.style.background = 'rgba(255, 107, 107, 0.25)';
                  e.currentTarget.style.borderColor = 'rgba(255, 107, 107, 0.5)';
                  e.currentTarget.style.transform = 'scale(1.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (isDebugMode || serverState === 'starting' || !loading) {
                  e.currentTarget.style.background = 'rgba(255, 107, 107, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(255, 107, 107, 0.3)';
                  e.currentTarget.style.transform = 'scale(1)';
                }
              }}
            >
              ⏹ Stop Server
            </button>
          </div>
        )}

        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(0.98); }
          }
        `}</style>

        {/* Stats Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '30px',
          marginTop: '40px',
          flexWrap: 'wrap',
        }}>
          <div style={{
            textAlign: 'center',
            padding: '15px 25px',
          }}>
            <div style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: status?.online ? '#55FF55' : '#ff6b6b',
              marginBottom: '5px',
            }}>
              {status?.online ? '●' : '○'}
            </div>
            <div style={{
              fontSize: '0.875rem',
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              {status?.online ? 'Online' : 'Offline'}
            </div>
          </div>

          <div style={{
            textAlign: 'center',
            padding: '15px 25px',
          }}>
            <div style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#FFB600',
              marginBottom: '5px',
            }}>
              {status?.playerCount ?? '—'}
            </div>
            <div style={{
              fontSize: '0.875rem',
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Players
            </div>
          </div>

          <div style={{
            textAlign: 'center',
            padding: '15px 25px',
          }}>
            <div style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#57A64E',
              marginBottom: '5px',
            }}>
              {status?.maxPlayers ?? '—'}
            </div>
            <div style={{
              fontSize: '0.875rem',
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Max Players
            </div>
          </div>

          <div style={{
            textAlign: 'center',
            padding: '15px 25px',
          }}>
            <div style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#5B9BD5',
              marginBottom: '5px',
            }}>
              {plugins.filter(p => p.state === 'ENABLED' || p.state === 'DISABLED_WILL_ENABLE_AFTER_RESTART').length}
            </div>
            <div style={{
              fontSize: '0.875rem',
              color: '#888',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Plugins
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{
        maxWidth: '1600px',
        margin: '0 auto',
        padding: '0 20px 60px',
      }}>
        <style>{`
          .responsive-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-bottom: 24px;
          }
          
          @media (max-width: 920px) {
            .responsive-grid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
        
        {/* Grid container for aligned columns */}
        <div className="responsive-grid">
          {/* First Row: Server Status and Server Plugins (50/50) */}
          <ServerStatus status={status} info={info} serverState={serverState} startupStep={startupStep} />
          <Plugins plugins={plugins} serverState={serverState} onPluginToggle={togglePlugin} />
          
          {/* Second Row: Version Selector and Session Timer (50/50) */}
          <VersionSelector 
            currentVersion={serverVersion} 
            supportedVersions={supportedVersions} 
            serverState={serverState}
            onVersionChange={updateVersion}
          />
          <SessionTimer serverState={serverState} />
          
          {/* Third Row: Players Online (full width or fit) */}
          <PlayerList players={players} />
        </div>

        {/* Terminal (full width) */}
        <Terminal serverState={serverState} />
      </div>

      {/* Floating Minimap */}
      <Minimap serverState={serverState} />
    </div>
  );
}
