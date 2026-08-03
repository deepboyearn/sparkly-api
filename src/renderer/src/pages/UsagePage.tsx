import { memo, useState, useEffect, useRef } from "react";
import { Line } from "react-chartjs-2";
import "../chartSetup";
import { Icon } from "@iconify/react/offline";
import { Card, Button } from "@heroui/react";
import { UsageRecordsTable } from "../components/UsageRecordsTable";
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

type StatRow = {
  model?: string;
  id?: string;
  name?: string;
  maskedKey?: string;
  requests: number;
  tokens: number;
  cost: number;
};

const SlidingTabs = ({ activeTab, onChange }: { activeTab: "By Hour" | "By Day", onChange: (tab: "By Hour" | "By Day") => void }) => {
  return (
    <div className="sliding-tabs">
      <div
        className="sliding-tabs-bg"
        style={{ transform: activeTab === "By Hour" ? "translateX(0%)" : "translateX(100%)" }}
      />
      <button
        className={`sliding-tab ${activeTab === "By Hour" ? "active" : ""}`}
        onClick={() => onChange("By Hour")}
      >
        By Hour
      </button>
      <button
        className={`sliding-tab ${activeTab === "By Day" ? "active" : ""}`}
        onClick={() => onChange("By Day")}
      >
        By Day
      </button>
    </div>
  );
};

const UsageModeSlidingTabs = ({ activeMode, onChange }: { activeMode: "statistics" | "records", onChange: (mode: "statistics" | "records") => void }) => {
  return (
    <div className="sliding-tabs" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div
        className="sliding-tabs-bg"
        style={{
          transform: activeMode === "statistics" ? "translateX(0%)" : "translateX(100%)",
          width: 'calc(50% - 4px)',
          background: 'linear-gradient(135deg, #f4b400 0%, #ff8c00 100%)',
          boxShadow: '0 4px 15px rgba(244, 180, 0, 0.2)'
        }}
      />
      <button
        className={`sliding-tab ${activeMode === "statistics" ? "active" : ""}`}
        onClick={() => onChange("statistics")}
        style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', fontWeight: 700, minWidth: '180px', justifyContent: 'center' }}
      >
        <Icon icon="solar:chart-square-bold-duotone" style={{ fontSize: '18px', color: activeMode === "statistics" ? "#000" : "inherit" }} />
        <span style={{ color: activeMode === "statistics" ? "#000" : "inherit" }}>Usage Statistics</span>
      </button>
      <button
        className={`sliding-tab ${activeMode === "records" ? "active" : ""}`}
        onClick={() => onChange("records")}
        style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', fontWeight: 700, minWidth: '180px', justifyContent: 'center' }}
      >
        <Icon icon="solar:document-text-bold-duotone" style={{ fontSize: '18px', color: activeMode === "records" ? "#000" : "inherit" }} />
        <span style={{ color: activeMode === "records" ? "#000" : "inherit" }}>Usage Records</span>
      </button>
    </div>
  );
};
function UsagePageComponent({
  usageMode,
  setUsageMode,
  state,
  totalTokenEstimate,
  rpm,
  totalCostEstimate,
  usageRequestChartData,
  usageRequestChartOptions,
  usageTokenChartData,
  usageTokenChartOptions,
  modelStats,
  keyStats,
  usageRecords,
  requestTab,
  setRequestTab,
  tokenTab,
  setTokenTab,
  realLogs,
  timeFilter,
  setTimeFilter,
}: {
  usageMode: "statistics" | "records";
  setUsageMode: (value: "statistics" | "records") => void;
  state: {
    stats: { totalRequests: number; successCount: number; errorCount: number };
    logs: any[];
    config: any;
    clientKeys: any[]
  };
  realLogs: any[];
  timeFilter: "24h" | "7d" | "30d" | "all";
  setTimeFilter: (val: "24h" | "7d" | "30d" | "all") => void;
  totalTokenEstimate: number;
  rpm: number;
  totalCostEstimate: number;
  usageRequestChartData: any;
  usageRequestChartOptions: any;
  usageTokenChartData: any;
  usageTokenChartOptions: any;
  modelStats: StatRow[];
  keyStats: StatRow[];
  usageRecords: UsageRecord[];
  requestTab: "By Hour" | "By Day";
  setRequestTab: (tab: "By Hour" | "By Day") => void;
  tokenTab: "By Hour" | "By Day";
  setTokenTab: (tab: "By Hour" | "By Day") => void;
}) {
  const [isDateMenuOpen, setIsDateMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDateMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <article className="admin-panel" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <UsageModeSlidingTabs activeMode={usageMode} onChange={setUsageMode} />
        <div style={{ marginLeft: 'auto', position: 'relative' }} ref={dropdownRef}>
          <Button
            className="premium-badge"
            variant="ghost"
            onClick={() => setIsDateMenuOpen(!isDateMenuOpen)}
            style={{ padding: '8px 16px', fontSize: '13px', height: 'auto', minWidth: 'auto', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <Icon icon="solar:calendar-bold-duotone" style={{ marginRight: '6px' }} />
            {timeFilter === 'all' ? 'All Time' :
              timeFilter === '24h' ? 'Last 24 Hours' :
                timeFilter === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
            <Icon icon="solar:alt-arrow-down-bold" style={{ marginLeft: '8px', fontSize: '10px' }} />
          </Button>

          {isDateMenuOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              width: '200px',
              background: '#0c0c0e',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '14px',
              padding: '6px',
              zIndex: 1000,
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              animation: 'slideInDown 0.2s ease'
            }}>
              {[
                { key: '24h', label: 'Last 24 Hours', icon: 'solar:clock-circle-bold' },
                { key: '7d', label: 'Last 7 Days', icon: 'solar:calendar-minimalistic-bold' },
                { key: '30d', label: 'Last 30 Days', icon: 'solar:calendar-bold' },
                { key: 'all', label: 'All Time', icon: 'solar:infinity-bold' }
              ].map((item) => (
                <div
                  key={item.key}
                  onClick={() => {
                    setTimeFilter(item.key as any);
                    setIsDateMenuOpen(false);
                  }}
                  className="custom-dropdown-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: timeFilter === item.key ? '#f4b400' : '#d1d1d6',
                    background: timeFilter === item.key ? 'rgba(244, 180, 0, 0.08)' : 'transparent',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Icon icon={item.icon} style={{ fontSize: '16px' }} />
                  {item.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </article>

      {usageMode === "statistics" ? <>
        <section className="stats-grid admin-stats-grid">
          <Card className="metric-card">
            <Card.Content className="metric-card-content">
              <div className="metric-head">
                <span className="metric-title" style={{ textTransform: 'uppercase' }}>Total requests</span>
                <div className="metric-icon-circle green">
                  <Icon icon="solar:bolt-bold-duotone" />
                </div>
              </div>
              <strong>{realLogs.length}</strong>
              <p>Success: {realLogs.filter((l: any) => l.status < 400).length} Failed: {realLogs.filter((l: any) => l.status >= 400).length}</p>

            </Card.Content>
          </Card>
          <Card className="metric-card">
            <Card.Content className="metric-card-content">
              <div className="metric-head">
                <span className="metric-title" style={{ textTransform: 'uppercase' }}>Total tokens</span>
                <div className="metric-icon-circle orange">
                  <Icon icon="solar:database-bold-duotone" />
                </div>
              </div>
              <strong>{totalTokenEstimate}</strong>
              <p>Cached: 0 Reasoning: {Math.round(totalTokenEstimate * 0.14)}</p>

            </Card.Content>
          </Card>
          <Card className="metric-card">
            <Card.Content className="metric-card-content">
              <div className="metric-head">
                <span className="metric-title" style={{ textTransform: 'uppercase' }}>RPM</span>
                <div className="metric-icon-circle green">
                  <Icon icon="solar:stopwatch-bold-duotone" />
                </div>
              </div>
              <strong>{rpm.toFixed(1)}</strong>
              <p>Last 30m: {state.stats.totalRequests} req</p>

            </Card.Content>
          </Card>
          <Card className="metric-card">
            <Card.Content className="metric-card-content">
              <div className="metric-head">
                <span className="metric-title" style={{ textTransform: 'uppercase' }}>Total cost</span>
                <div className="metric-icon-circle yellow">
                  <Icon icon="solar:wad-of-money-bold-duotone" />
                </div>
              </div>
              <strong>${totalCostEstimate.toFixed(2)}</strong>
              <p>Points: {Math.round(totalCostEstimate * 1000)}</p>

            </Card.Content>
          </Card>
        </section>

        <section className="usage-chart-grid">
          <article className="admin-panel usage-chart-panel">
            <div className="section-heading">
              <h3>Request Trends</h3>
              <SlidingTabs activeTab={requestTab} onChange={setRequestTab} />
            </div>
            <div className="usage-line-chart-shell green-chart-shell">
              <Line data={usageRequestChartData as never} options={usageRequestChartOptions as never} />
            </div>
          </article>

          <article className="admin-panel usage-chart-panel">
            <div className="section-heading">
              <h3>Token Usage Trends</h3>
              <SlidingTabs activeTab={tokenTab} onChange={setTokenTab} />
            </div>
            <div className="usage-line-chart-shell orange-chart-shell">
              <Line data={usageTokenChartData as never} options={usageTokenChartOptions as never} />
            </div>
          </article>
        </section>

        <section className="usage-chart-grid lower-grid">
          <article className="admin-panel usage-table-panel">
            <div className="usage-table-header">
              <span>Model</span>
              <span>Requests</span>
              <span>Tokens</span>
              <span>Cost</span>
            </div>
            {modelStats.length === 0 ? <div className="empty-logs dark-empty">No usage data yet.</div> : null}
            {modelStats.map((row) => (
              <div className="usage-table-row" key={row.model}>
                <span>{row.model}</span>
                <span>{row.requests}</span>
                <span>{row.tokens}</span>
                <span>${row.cost.toFixed(2)}</span>
              </div>
            ))}
            <div className="usage-table-footer"><strong>Model Statistics</strong><span>20 rows</span></div>
          </article>

          <article className="admin-panel usage-table-panel">
            <div className="usage-table-header">
              <span>API Key</span>
              <span>Requests</span>
              <span>Tokens</span>
              <span>Cost</span>
            </div>
            {keyStats.length === 0 ? <div className="empty-logs dark-empty">No API usage yet.</div> : null}
            {keyStats.map((row) => (
              <div className="usage-table-row" key={row.id}>
                <span>{row.name} • {row.maskedKey}</span>
                <span>{row.requests}</span>
                <span>{row.tokens}</span>
                <span>${row.cost.toFixed(2)}</span>
              </div>
            ))}
            <div className="usage-table-footer"><strong>API Key Details</strong><span>5 rows</span></div>
          </article>
        </section>

      </> : null}

      {usageMode === "records" ? <section className="usage-records-panel admin-panel" style={{ padding: '0' }}>
        <UsageRecordsTable records={usageRecords} />
      </section> : null}
    </>
  );
}

export const UsagePage = memo(UsagePageComponent, (prev, next) => {
  return prev.usageMode === next.usageMode
    && prev.state === next.state
    && prev.state.logs === next.state.logs
    && prev.realLogs === next.realLogs
    && prev.totalTokenEstimate === next.totalTokenEstimate
    && prev.rpm === next.rpm
    && prev.totalCostEstimate === next.totalCostEstimate
    && prev.usageRequestChartData === next.usageRequestChartData
    && prev.usageRequestChartOptions === next.usageRequestChartOptions
    && prev.usageTokenChartData === next.usageTokenChartData
    && prev.usageTokenChartOptions === next.usageTokenChartOptions
    && prev.modelStats === next.modelStats
    && prev.keyStats === next.keyStats
    && prev.usageRecords === next.usageRecords
    && prev.requestTab === next.requestTab
    && prev.tokenTab === next.tokenTab
    && prev.timeFilter === next.timeFilter;
});

export default UsagePage;
