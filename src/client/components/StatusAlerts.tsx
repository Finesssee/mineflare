import type { ConnectionInfo } from '../types/api';

interface Alert {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

interface Props {
  connectionInfo?: ConnectionInfo | null;
  errorMessage?: string | null;
}

const severityStyles: Record<Alert['severity'], { border: string; background: string; color: string }> = {
  info: {
    border: 'rgba(91, 155, 213, 0.5)',
    background: 'rgba(91, 155, 213, 0.15)',
    color: '#BBD8FF',
  },
  warning: {
    border: 'rgba(255, 182, 0, 0.5)',
    background: 'rgba(255, 182, 0, 0.15)',
    color: '#FFE7B5',
  },
  error: {
    border: 'rgba(255, 68, 68, 0.5)',
    background: 'rgba(255, 68, 68, 0.15)',
    color: '#FFC1C1',
  },
};

const severityLabel: Record<Alert['severity'], string> = {
  info: 'Heads up',
  warning: 'Action needed',
  error: 'Failure',
};

export function StatusAlerts({ connectionInfo, errorMessage }: Props) {
  const alerts: Alert[] = [];

  if (errorMessage) {
    alerts.push({
      id: 'server-error',
      title: 'Server error',
      message: errorMessage,
      severity: 'error',
    });
  }

  if (connectionInfo) {
    if (connectionInfo.status === 'error') {
      alerts.push({
        id: 'tunnel-error',
        title: 'Cloudflare Tunnel failure',
        message: connectionInfo.message,
        severity: 'error',
      });
    } else if (connectionInfo.status === 'pending') {
      alerts.push({
        id: 'tunnel-pending',
        title: 'Cloudflare Tunnel pending',
        message: connectionInfo.message,
        severity: 'warning',
      });
    } else if (connectionInfo.status === 'not-configured') {
      alerts.push({
        id: 'tunnel-config',
        title: 'Cloudflare Tunnel not configured',
        message: connectionInfo.message,
        severity: 'warning',
      });
    }
  }

  if (alerts.length === 0) {
    return null;
  }

  return (
    <div style={{
      maxWidth: '1200px',
      margin: '0 auto 20px auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    }}>
      {alerts.map((alert) => {
        const styles = severityStyles[alert.severity];
        return (
          <div
            key={alert.id}
            style={{
              border: `1px solid ${styles.border}`,
              background: styles.background,
              color: styles.color,
              borderRadius: '14px',
              padding: '14px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}>
              <div style={{
                fontSize: '0.8rem',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: styles.color,
              }}>
                {severityLabel[alert.severity]}
              </div>
              <div style={{
                fontSize: '0.85rem',
                color: '#ffffff',
                opacity: 0.7,
              }}>
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: '#ffffff',
            }}>
              {alert.title}
            </div>
            <div style={{
              fontSize: '0.95rem',
              lineHeight: 1.5,
              color: '#e9e9e9',
            }}>
              {alert.message}
            </div>
          </div>
        );
      })}
    </div>
  );
}
