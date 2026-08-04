import { Icon } from "@iconify/react";
import { memo } from "react";

type UsageRecord = {
  id: string;
  time: string;
  model: string;
  tokens: number;
  tps: number;
  responseTime: string;
  status: number;
  source: string;
  ip: string;
  apiKey: string;
  amountSpent: string;
  balanceChange: string;
  requestId: string;
  requestType?: "model_probe" | "chat" | "responses";
};

export const UsageRecordsTable = memo(({ records }: { records: UsageRecord[] }) => {
  if (records.length === 0) {
    return <div style={{ padding: '80px', textAlign: 'center', color: '#52525b', fontSize: '14px', letterSpacing: '0.02em' }}>No records found.</div>;
  }

  return (
    <div style={{ width: '100%', overflowX: 'auto', background: 'transparent' }}>
      <table style={{ 
        width: '100%', 
        borderCollapse: 'collapse', 
        fontSize: '12.5px', 
        color: '#e2e2e7',
        textAlign: 'left',
        fontFamily: "'Inter', sans-serif"
      }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.01)' }}>
            <th style={headerStyle}>Time</th>
            <th style={headerStyle}>Model</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Tokens</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>TPS</th>
            <th style={headerStyle}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                 <Icon icon="solar:stopwatch-bold" style={{ fontSize: '14px', opacity: 0.5 }} />
                 Response
               </div>
            </th>
            <th style={{ ...headerStyle, textAlign: 'center' }}>Status</th>
            <th style={headerStyle}>Source</th>
            <th style={headerStyle}>IP Address</th>
            <th style={headerStyle}>API Key</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Spent</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Balance</th>
            <th style={headerStyle}>Request ID</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} style={{ 
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              transition: 'background 0.2s ease'
            }}>
              <td style={cellStyle}>
                <span style={{ opacity: 0.7, fontSize: '11px' }}>{record.time.split(',')[0]}</span>
                <br />
                <span style={{ fontWeight: 600, color: '#fff' }}>{record.time.split(',')[1]}</span>
              </td>
              <td style={{ ...cellStyle, borderLeft: '1px solid rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {record.requestType === 'model_probe' ? (
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1' }} title="Model Probe" />
                  ) : (
                    <Icon icon="solar:globus-bold" style={{ fontSize: '16px', color: '#10b981', opacity: 0.6 }} />
                  )}
                  <span style={{ fontWeight: 500, color: '#fff' }}>{record.model}</span>
                </div>
              </td>
              <td style={{ ...cellStyle, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#a1a1aa' }}>
                —
              </td>
              <td style={{ ...cellStyle, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#a1a1aa' }}>
                —
              </td>
              <td style={{ ...cellStyle, fontWeight: 500 }}>
                <span style={{ color: parseInt(record.responseTime) > 1000 ? '#f59e0b' : '#fff' }}>{record.responseTime}</span>
              </td>
              <td style={{ ...cellStyle, textAlign: 'center' }}>
                <span style={{ 
                  color: record.status >= 400 ? '#fb7185' : '#34d399',
                  background: record.status >= 400 ? 'rgba(251, 113, 133, 0.1)' : 'rgba(52, 211, 153, 0.1)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 800
                }}>
                  {record.status}
                </span>
              </td>
              <td style={cellStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 }}>
                  <Icon icon="solar:link-bold" style={{ fontSize: '14px' }} />
                  {record.source}
                </div>
              </td>
              <td style={{ ...cellStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', opacity: 0.6 }}>{record.ip}</td>
              <td style={cellStyle}>
                <div style={{ 
                  padding: '4px 8px', 
                  background: 'rgba(255,255,255,0.03)', 
                  border: '1px solid rgba(255,255,255,0.05)', 
                  borderRadius: '6px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '11px',
                  color: '#94a3b8'
                }}>
                  {record.apiKey}
                </div>
              </td>
              <td style={{ ...cellStyle, textAlign: 'right', color: '#fbbf24', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                —
              </td>
              <td style={{ ...cellStyle, textAlign: 'right', color: record.balanceChange.startsWith('-') ? '#fb7185' : '#34d399', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                —
              </td>
              <td style={{ ...cellStyle, borderLeft: '1px solid rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                   <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', opacity: 0.4 }}>{record.requestId}</span>
                   <Icon icon="solar:copy-bold" style={{ fontSize: '12px', opacity: 0.3, cursor: 'pointer' }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

const headerStyle: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: '10px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: '#52525b',
  whiteSpace: 'nowrap'
};

const cellStyle: React.CSSProperties = {
  padding: '14px 16px',
  whiteSpace: 'nowrap',
  verticalAlign: 'middle'
};

