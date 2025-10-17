import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useToolOutput, useDisplayMode, useTheme, useMaxHeight } from '../shared/useOpenAiGlobal';

interface DynmapData {
  dynmapUrl: string;
  mapEnabled: boolean;
}

export function Dynmap() {
  const data = useToolOutput<DynmapData>();
  const displayMode = useDisplayMode();
  const theme = useTheme();
  const maxHeight = useMaxHeight();
  const [requestedFullscreen, setRequestedFullscreen] = useState(false);

  // Auto-request fullscreen on mount
  useEffect(() => {
    if (!requestedFullscreen && displayMode === 'inline' && window.openai?.requestDisplayMode) {
      window.openai.requestDisplayMode({ mode: 'fullscreen' });
      setRequestedFullscreen(true);
    }
  }, [displayMode, requestedFullscreen]);

  if (!data) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Loading map...</div>;
  }

  const { dynmapUrl, mapEnabled } = data;
  const isDark = theme === 'dark';

  if (!mapEnabled || !dynmapUrl) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        padding: '40px',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: isDark ? '#1a1a1a' : '#ffffff',
        color: isDark ? '#e0e0e0' : '#1a1a1a',
        borderRadius: displayMode === 'inline' ? '16px' : '0',
      }}>
        <div>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🗺️</div>
          <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
            Dynmap Not Available
          </div>
          <div style={{ fontSize: '14px', color: isDark ? '#888' : '#666' }}>
            The Dynmap plugin needs to be enabled and the server must be running
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      height: displayMode === 'fullscreen' ? maxHeight || '100vh' : '600px',
      position: 'relative',
      background: isDark ? '#000' : '#fff',
      borderRadius: displayMode === 'inline' ? '16px' : '0',
      overflow: 'hidden',
    }}>
      <iframe
        src={dynmapUrl}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
        }}
        title="Minecraft World Map"
        allow="fullscreen"
      />
    </div>
  );
}









