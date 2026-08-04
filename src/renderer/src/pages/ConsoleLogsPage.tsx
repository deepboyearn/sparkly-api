import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import {
  subscribe,
  clearLogs,
  type ConsoleLogEntry,
  type LogLevel,
} from "../consoleLogStore";

const LEVEL_COLORS: Record<LogLevel, string> = {
  success: "#10b981",
  error: "#f43f5e",
  warning: "#eab308",
  info: "#60a5fa",
};

const LEVEL_ICONS: Record<LogLevel, string> = {
  success: "solar:check-circle-bold-duotone",
  error: "solar:close-circle-bold-duotone",
  warning: "solar:bell-bing-bold-duotone",
  info: "solar:info-circle-bold-duotone",
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function LogEntryRow({ entry }: { entry: ConsoleLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = entry.requestData != null || entry.responseData != null;
  return (
    <div
      className="console-log-entry"
      style={{ borderLeftColor: LEVEL_COLORS[entry.level] }}
    >
      <div
        className="console-log-row"
        onClick={() => hasPayload && setExpanded(!expanded)}
        style={{ cursor: hasPayload ? "pointer" : "default" }}
      >
        <span className="console-log-time">{formatTime(entry.timestamp)}</span>
        <span
          className="console-log-level"
          style={{ color: LEVEL_COLORS[entry.level] }}
        >
          <Icon icon={LEVEL_ICONS[entry.level]} style={{ fontSize: "14px" }} />
          {entry.level.toUpperCase()}
        </span>
        <span className="console-log-method">{entry.method}</span>
        <span className="console-log-url" title={entry.url}>
          {entry.url}
        </span>
        {entry.statusCode !== null && (
          <span
            className="console-log-status"
            style={{
              color:
                entry.statusCode >= 400
                  ? LEVEL_COLORS.error
                  : entry.statusCode >= 200 && entry.statusCode < 300
                    ? LEVEL_COLORS.success
                    : LEVEL_COLORS.warning,
            }}
          >
            {entry.statusCode}
          </span>
        )}
        <span className="console-log-duration">{formatMs(entry.durationMs)}</span>
        {hasPayload && (
          <Icon
            icon={(expanded ? "solar:alt-arrow-up-bold" : "solar:alt-arrow-down-bold") as string}
            style={{ fontSize: "12px", opacity: 0.4, flexShrink: 0 }}
          />
        )}
      </div>
      {entry.errorMessage && (
        <div className="console-log-error">{entry.errorMessage}</div>
      )}
      {expanded && (
        <div className="console-log-payloads">
          {entry.requestData != null && (
            <div className="console-log-payload">
              <span className="console-log-payload-label">Request</span>
              <pre>{JSON.stringify(entry.requestData, null, 2) as React.ReactNode}</pre>
            </div>
          )}
          {entry.responseData != null && (
            <div className="console-log-payload">
              <span className="console-log-payload-label">Response</span>
              <pre>{JSON.stringify(entry.responseData, null, 2) as React.ReactNode}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MemoLogEntryRow = memo(LogEntryRow);

export default function ConsoleLogsPage() {
  const [logs, setLogs] = useState<ConsoleLogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribe(setLogs);
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [logs.length, autoScroll]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return logs.filter((l) => {
      if (levelFilter !== "all" && l.level !== levelFilter) return false;
      if (q) {
        return (
          l.method.toLowerCase().includes(q) ||
          l.url.toLowerCase().includes(q) ||
          l.errorMessage?.toLowerCase().includes(q) ||
          String(l.statusCode).includes(q)
        );
      }
      return true;
    });
  }, [logs, search, levelFilter]);

  const handleClear = useCallback(() => {
    clearLogs();
  }, []);

  const counts = useMemo(() => {
    const c = { total: logs.length, success: 0, error: 0, warning: 0, info: 0 };
    for (const l of logs) c[l.level]++;
    return c;
  }, [logs]);

  return (
    <div className="console-logs-page">
      {/* Header */}
      <div className="console-logs-header">
        <div className="console-logs-title">
          <Icon icon="material-symbols:bug-report-rounded" style={{ fontSize: "22px", color: "var(--primary)" }} />
          <h3>Console Logs</h3>
          <span className="console-logs-count">{counts.total}</span>
        </div>
        <div className="console-logs-actions">
          <div className="console-logs-stats">
            <span style={{ color: LEVEL_COLORS.success }}>✓ {counts.success}</span>
            <span style={{ color: LEVEL_COLORS.error }}>✕ {counts.error}</span>
            <span style={{ color: LEVEL_COLORS.warning }}>⚠ {counts.warning}</span>
            <span style={{ color: LEVEL_COLORS.info }}>ℹ {counts.info}</span>
          </div>
          <button
            className={`console-logs-autoscroll-btn ${autoScroll ? "active" : ""}`}
            onClick={() => setAutoScroll(!autoScroll)}
            title="Auto-scroll to latest"
          >
            <Icon icon="solar:sort-from-bottom-to-top-bold" style={{ fontSize: "14px" }} />
          </button>
          <button className="console-logs-clear-btn" onClick={handleClear}>
            <Icon icon="solar:trash-bin-trash-bold" style={{ fontSize: "14px" }} />
            Clear Logs
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="console-logs-filters">
        <div className="console-logs-search">
          <Icon icon="solar:magnifer-linear" style={{ fontSize: "16px", opacity: 0.4 }} />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>
              <Icon icon="solar:close-circle-bold" style={{ fontSize: "14px" }} />
            </button>
          )}
        </div>
        <div className="console-logs-level-filters">
          {(["all", "success", "error", "warning", "info"] as const).map((lvl) => (
            <button
              key={lvl}
              className={`console-logs-level-btn ${levelFilter === lvl ? "active" : ""}`}
              onClick={() => setLevelFilter(lvl)}
              style={levelFilter === lvl && lvl !== "all" ? { borderColor: LEVEL_COLORS[lvl], color: LEVEL_COLORS[lvl] } : {}}
            >
              {lvl === "all" ? "All" : lvl.charAt(0).toUpperCase() + lvl.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Log entries */}
      <div className="console-logs-list" ref={scrollRef}>
        {filtered.length === 0 ? (
          <div className="console-logs-empty">
            <Icon icon="solar:widget-2-bold-duotone" style={{ fontSize: "48px", opacity: 0.15 }} />
            <p>No logs yet</p>
            <p style={{ fontSize: "12px", opacity: 0.4 }}>API calls and events will appear here</p>
          </div>
        ) : (
          filtered.map((entry) => <MemoLogEntryRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
