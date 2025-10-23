import { useState } from 'preact/hooks';
import type { SupportedVersion } from '../types/api';

interface Props {
  currentVersion: string;
  supportedVersions: SupportedVersion[];
  serverState: 'stopped' | 'starting' | 'running' | 'stopping';
  onVersionChange: (version: string) => Promise<void>;
}

export function VersionSelector({ currentVersion, supportedVersions, serverState, onVersionChange }: Props) {
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [hoveredVersion, setHoveredVersion] = useState<string | null>(null);

  const canChange = serverState === 'stopped';

  const handleVersionSelect = async (version: string) => {
    if (!canChange || updating || version === currentVersion) return;
    
    try {
      setUpdating(true);
      setUpdateError(null);
      await onVersionChange(version);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Failed to update version');
    } finally {
      setUpdating(false);
    }
  };

  const getVersionLabel = (label: string) => {
    switch (label) {
      case 'legacy':
        return { text: 'Legacy', color: '#888', gradient: 'linear-gradient(135deg, #666 0%, #555 100%)' };
      case 'stable':
        return { text: 'Stable', color: '#57A64E', gradient: 'linear-gradient(135deg, #57A64E 0%, #6BB854 100%)' };
      case 'experimental':
        return { text: 'Experimental', color: '#FFB600', gradient: 'linear-gradient(135deg, #FFB600 0%, #FFC933 100%)' };
      default:
        return { text: label, color: '#888', gradient: 'linear-gradient(135deg, #666 0%, #555 100%)' };
    }
  };

  return (
    <div style={{
      background: 'rgba(26, 46, 30, 0.4)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(87, 166, 78, 0.2)',
      borderRadius: '16px',
      padding: '32px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
      transition: 'all 0.3s ease',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.borderColor = 'rgba(87, 166, 78, 0.4)';
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.4)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = 'rgba(87, 166, 78, 0.2)';
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
    }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '24px',
      }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, #5B9BD5 0%, #7AB3E8 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          marginRight: '16px',
          boxShadow: '0 4px 12px rgba(91, 155, 213, 0.3)',
        }}>
          🎮
        </div>
        <div>
          <h2 style={{
            margin: '0 0 4px 0',
            fontSize: '1.5rem',
            fontWeight: '700',
            color: '#fff',
          }}>
            Minecraft Version
          </h2>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span style={{
              color: canChange ? '#55FF55' : '#888',
              fontWeight: '600',
              fontSize: '0.875rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              {canChange ? 'Editable' : 'Stop server to change'}
            </span>
          </div>
        </div>
      </div>

      {updateError && (
        <div style={{
          marginBottom: '16px',
          padding: '12px 16px',
          background: 'rgba(255, 71, 71, 0.1)',
          border: '1px solid rgba(255, 71, 71, 0.3)',
          borderRadius: '8px',
          color: '#ff6b6b',
          fontSize: '0.875rem',
        }}>
          ⚠️ {updateError}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
        marginBottom: '16px',
      }}>
        {supportedVersions.map((sv) => {
          const labelInfo = getVersionLabel(sv.label);
          const isSelected = sv.version === currentVersion;
          const isHovered = hoveredVersion === sv.version;
          const isClickable = canChange && !updating && !isSelected;

          return (
            <div
              key={sv.version}
              onClick={() => isClickable && handleVersionSelect(sv.version)}
              onMouseEnter={() => setHoveredVersion(sv.version)}
              onMouseLeave={() => setHoveredVersion(null)}
              style={{
                position: 'relative',
                padding: '16px',
                background: isSelected 
                  ? 'rgba(87, 166, 78, 0.15)' 
                  : 'rgba(255, 255, 255, 0.03)',
                border: isSelected 
                  ? '2px solid rgba(87, 166, 78, 0.5)' 
                  : '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                cursor: isClickable ? 'pointer' : 'default',
                transition: 'all 0.2s ease',
                opacity: (!canChange || updating) ? 0.6 : 1,
                transform: isClickable && isHovered ? 'translateY(-2px)' : 'translateY(0)',
                boxShadow: isClickable && isHovered 
                  ? '0 4px 12px rgba(87, 166, 78, 0.3)' 
                  : 'none',
              }}
            >
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                alignItems: 'center',
              }}>
                <div style={{
                  padding: '6px 12px',
                  background: labelInfo.gradient,
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: '700',
                  color: sv.label === 'legacy' ? '#fff' : '#000',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  boxShadow: `0 2px 8px ${labelInfo.color}33`,
                }}>
                  {labelInfo.text}
                </div>
                <div style={{
                  fontSize: '1.125rem',
                  fontWeight: '700',
                  color: '#fff',
                  fontFamily: 'monospace',
                }}>
                  {sv.version}
                </div>
                {isSelected && (
                  <div style={{
                    fontSize: '0.75rem',
                    color: '#57A64E',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>
                    ✓ Current
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Warning message */}
      <div style={{
        padding: '12px 16px',
        background: 'rgba(255, 182, 0, 0.1)',
        border: '1px solid rgba(255, 182, 0, 0.3)',
        borderRadius: '8px',
        color: '#FFB600',
        fontSize: '0.75rem',
        lineHeight: '1.4',
      }}>
        <div style={{ marginBottom: '4px', fontWeight: '600' }}>
          ⚠️ Important
        </div>
        <div style={{ color: '#d4a356' }}>
          • Downgrading may not be fully supported
        </div>
      </div>

      {updating && (
        <div style={{
          marginTop: '16px',
          padding: '12px 16px',
          background: 'rgba(87, 166, 78, 0.1)',
          border: '1px solid rgba(87, 166, 78, 0.3)',
          borderRadius: '8px',
          color: '#57A64E',
          fontSize: '0.875rem',
          textAlign: 'center',
        }}>
          ⏳ Updating version...
        </div>
      )}
    </div>
  );
}

