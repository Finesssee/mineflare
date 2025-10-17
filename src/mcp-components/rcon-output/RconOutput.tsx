import { useToolOutput, useTheme } from '../shared/useOpenAiGlobal';

interface RconOutputData {
  success: boolean;
  output: string;
  command: string;
  error?: string;
}

export function RconOutput() {
  const data = useToolOutput<RconOutputData>();
  const theme = useTheme();

  if (!data) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Executing command...</div>;
  }

  const { success, output, command, error } = data;
  const isDark = theme === 'dark';

  const handleExecuteAnother = () => {
    window.openai?.sendFollowUpMessage?.({ 
      prompt: 'I want to run another RCON command' 
    });
  };

  const handleQuickCommand = (cmd: string) => {
    window.openai?.sendFollowUpMessage?.({ 
      prompt: `run command: ${cmd}` 
    });
  };

  const quickCommands = [
    { label: 'List Players', command: 'list' },
    { label: 'Set Time Day', command: 'time set day' },
    { label: 'Set Weather Clear', command: 'weather clear' },
    { label: 'Give Diamond', command: 'give @p diamond 1' },
  ];

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "SF Mono", Menlo, Consolas, monospace',
      background: isDark ? '#0a0a0a' : '#1a1a1a',
      color: '#e0e0e0',
      border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.15)'}`,
      borderRadius: '12px',
      padding: '0',
      maxWidth: '650px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        background: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.05)',
        borderBottom: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.15)'}`,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: success ? '#57A64E' : '#ff6b6b',
          boxShadow: `0 0 8px ${success ? '#57A64E' : '#ff6b6b'}`,
        }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', color: '#888' }}>RCON Command</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: '#fff', fontFamily: 'monospace' }}>
            {command}
          </div>
        </div>
      </div>

      {/* Output */}
      <div style={{
        padding: '20px',
        background: '#000',
        minHeight: '120px',
        maxHeight: '400px',
        overflowY: 'auto',
      }}>
        {success ? (
          <pre style={{
            margin: 0,
            fontFamily: '"SF Mono", Menlo, Consolas, monospace',
            fontSize: '13px',
            lineHeight: '1.6',
            color: '#57A64E',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {output || '(command executed successfully, no output)'}
          </pre>
        ) : (
          <div>
            <div style={{
              fontSize: '14px',
              color: '#ff6b6b',
              fontWeight: '600',
              marginBottom: '8px',
            }}>
              ⚠️ Command Failed
            </div>
            <pre style={{
              margin: 0,
              fontFamily: '"SF Mono", Menlo, Consolas, monospace',
              fontSize: '13px',
              lineHeight: '1.6',
              color: '#ff6b6b',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {error || output || 'Unknown error occurred'}
            </pre>
          </div>
        )}
      </div>

      {/* Quick Commands */}
      <div style={{
        padding: '16px 20px',
        background: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.05)',
        borderTop: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.15)'}`,
      }}>
        <div style={{
          fontSize: '12px',
          color: '#888',
          marginBottom: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Quick Commands
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '8px',
        }}>
          {quickCommands.map((qc) => (
            <button
              key={qc.command}
              onClick={() => handleQuickCommand(qc.command)}
              style={{
                padding: '8px 12px',
                background: isDark ? 'rgba(87, 166, 78, 0.1)' : 'rgba(87, 166, 78, 0.15)',
                color: '#57A64E',
                border: `1px solid ${isDark ? 'rgba(87, 166, 78, 0.25)' : 'rgba(87, 166, 78, 0.3)'}`,
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s',
                textAlign: 'left',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = isDark ? 'rgba(87, 166, 78, 0.2)' : 'rgba(87, 166, 78, 0.25)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = isDark ? 'rgba(87, 166, 78, 0.1)' : 'rgba(87, 166, 78, 0.15)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {qc.label}
            </button>
          ))}
        </div>

        {/* Execute Another Button */}
        <button
          onClick={handleExecuteAnother}
          style={{
            width: '100%',
            marginTop: '12px',
            padding: '10px 16px',
            background: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.08)',
            color: '#fff',
            border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.2)'}`,
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.12)';
            e.currentTarget.style.transform = 'scale(1.01)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          ↻ Execute Another Command
        </button>
      </div>
    </div>
  );
}









