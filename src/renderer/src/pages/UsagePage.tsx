import { memo } from "react";
import { Line } from "react-chartjs-2";

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

function UsagePageComponent({
  usageMode,
  setUsageMode,
  state,
  totalTokenEstimate,
  rpm,
  tpm,
  totalCostEstimate,
  usageRequestChartData,
  usageRequestChartOptions,
  usageTokenChartData,
  usageTokenChartOptions,
  modelStats,
  keyStats,
  usageRecords,
}: {
  usageMode: "statistics" | "records";
  setUsageMode: (value: "statistics" | "records") => void;
  state: { stats: { totalRequests: number; successCount: number; errorCount: number } };
  totalTokenEstimate: number;
  rpm: number;
  tpm: number;
  totalCostEstimate: number;
  usageRequestChartData: object;
  usageRequestChartOptions: object;
  usageTokenChartData: object;
  usageTokenChartOptions: object;
  modelStats: StatRow[];
  keyStats: StatRow[];
  usageRecords: UsageRecord[];
}) {
  return (
    <>
      <section className="usage-tabs-row">
        <div className="tab-pills">
          <button className={`tab-pill ${usageMode === "statistics" ? "active-tab" : ""}`} onClick={() => setUsageMode("statistics")}>Usage Statistics</button>
          <button className={`tab-pill ${usageMode === "records" ? "active-tab" : ""}`} onClick={() => setUsageMode("records")}>Usage Records</button>
        </div>
        <div className="date-pill">Apr 7 - Apr 14, 2026 (UTC)</div>
      </section>

      {usageMode === "statistics" ? <>
        <section className="stats-grid admin-stats-grid">
          <article className="metric-card">
            <div className="metric-head"><span>Total requests</span><span className="metric-chip green">↯</span></div>
            <strong>{state.stats.totalRequests}</strong>
            <p>Success: {state.stats.successCount} Failed: {state.stats.errorCount}</p>
            <div className="metric-bar"><i style={{ width: `${Math.min(100, state.stats.totalRequests * 8)}%` }} /></div>
          </article>
          <article className="metric-card">
            <div className="metric-head"><span>Total tokens</span><span className="metric-chip orange">◎</span></div>
            <strong>{totalTokenEstimate}</strong>
            <p>Cached: 0 Reasoning: {Math.round(totalTokenEstimate * 0.14)}</p>
            <div className="metric-bar"><i style={{ width: `${Math.min(100, totalTokenEstimate / 50)}%` }} /></div>
          </article>
          <article className="metric-card">
            <div className="metric-head"><span>RPM</span><span className="metric-chip green">◔</span></div>
            <strong>{rpm.toFixed(1)}</strong>
            <p>Last 30m: {state.stats.totalRequests} req</p>
            <div className="metric-bar"><i style={{ width: `${Math.min(100, rpm * 10)}%` }} /></div>
          </article>
          <article className="metric-card">
            <div className="metric-head"><span>TPM</span><span className="metric-chip blue">⌁</span></div>
            <strong>{tpm}</strong>
            <p>Last 30m: {Math.round(totalTokenEstimate / 2)} tokens</p>
            <div className="metric-bar"><i style={{ width: `${Math.min(100, tpm / 40)}%` }} /></div>
          </article>
          <article className="metric-card">
            <div className="metric-head"><span>Total cost</span><span className="metric-chip yellow">$</span></div>
            <strong>${totalCostEstimate.toFixed(2)}</strong>
            <p>Points: {Math.round(totalCostEstimate * 1000)}</p>
            <div className="metric-bar"><i style={{ width: `${Math.min(100, totalCostEstimate * 100)}%` }} /></div>
          </article>
        </section>

        <section className="usage-chart-grid">
          <article className="admin-panel usage-chart-panel">
            <div className="section-heading">
              <h3>Request Trends</h3>
              <div className="tab-pills small-pills"><button className="tab-pill active-tab">By Hour</button><button className="tab-pill">By Day</button></div>
            </div>
            <div className="usage-line-chart-shell green-chart-shell">
              <Line data={usageRequestChartData as never} options={usageRequestChartOptions as never} />
            </div>
          </article>

          <article className="admin-panel usage-chart-panel">
            <div className="section-heading">
              <h3>Token Usage Trends</h3>
              <div className="tab-pills small-pills"><button className="tab-pill active-tab">By Hour</button><button className="tab-pill">By Day</button></div>
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

      {usageMode === "records" ? <section className="usage-records-panel admin-panel">
        <div className="usage-records-table-wrap">
          <div className="usage-table-header usage-record-header wide-record-grid">
            <span>Time</span>
            <span>Model</span>
            <span>Tokens</span>
            <span>TPS</span>
            <span>Response Time</span>
            <span>Status</span>
            <span>Source</span>
            <span>IP</span>
            <span>API Key</span>
            <span>Amount Spent</span>
            <span>Balance Change</span>
            <span>Request ID</span>
          </div>
          {usageRecords.length === 0 ? <div className="empty-logs dark-empty">No usage records yet.</div> : null}
          {usageRecords.map((record) => (
            <div className="usage-record-row wide-record-grid" key={record.id}>
              <span>{record.time}</span>
              <span>{record.model}</span>
              <span>{record.tokens}</span>
              <span>{record.tps}</span>
              <span>{record.responseTime}</span>
              <span className={record.status >= 400 ? "status-bad" : "status-good"}>{record.status}</span>
              <span>{record.source}</span>
              <span>{record.ip}</span>
              <span>{record.apiKey}</span>
              <span>{record.amountSpent}</span>
              <span>{record.balanceChange}</span>
              <span>{record.requestId}</span>
            </div>
          ))}
        </div>
      </section> : null}
    </>
  );
}

export const UsagePage = memo(UsagePageComponent, (prev, next) => {
  return prev.usageMode === next.usageMode
    && prev.state === next.state
    && prev.totalTokenEstimate === next.totalTokenEstimate
    && prev.rpm === next.rpm
    && prev.tpm === next.tpm
    && prev.totalCostEstimate === next.totalCostEstimate
    && prev.usageRequestChartData === next.usageRequestChartData
    && prev.usageRequestChartOptions === next.usageRequestChartOptions
    && prev.usageTokenChartData === next.usageTokenChartData
    && prev.usageTokenChartOptions === next.usageTokenChartOptions
    && prev.modelStats === next.modelStats
    && prev.keyStats === next.keyStats
    && prev.usageRecords === next.usageRecords;
});
