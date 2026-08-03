// consoleLogStore.ts — Centralized log store with subscriber pattern.
// Persists across page navigation. Logs to browser console as well.

export type LogLevel = "info" | "success" | "warning" | "error";

export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  method: string;
  url: string;
  statusCode: number | null;
  durationMs: number;
  errorMessage?: string;
  requestData?: unknown;
  responseData?: unknown;
  source: "ipc" | "http" | "system";
}

type Listener = (logs: ConsoleLogEntry[]) => void;

const MAX_LOGS = 500;
const listeners = new Set<Listener>();
let logs: ConsoleLogEntry[] = [];
let idCounter = 0;

function notify() {
  for (const fn of listeners) fn(logs);
}

function addEntry(entry: ConsoleLogEntry) {
  logs = [entry, ...logs].slice(0, MAX_LOGS);
  // Also log to browser console
  const style =
    entry.level === "error"
      ? "color: #f43f5e; font-weight: bold"
      : entry.level === "warning"
        ? "color: #eab308; font-weight: bold"
        : entry.level === "success"
          ? "color: #10b981; font-weight: bold"
          : "color: #60a5fa; font-weight: bold";
  console.log(
    `%c[${entry.level.toUpperCase()}] ${entry.method} ${entry.url} ${entry.statusCode ?? "—"} ${entry.durationMs}ms`,
    style,
    entry.errorMessage ?? "",
  );
  notify();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(logs); // emit current state immediately
  return () => listeners.delete(listener);
}

export function getLogs(): ConsoleLogEntry[] {
  return logs;
}

export function clearLogs() {
  logs = [];
  notify();
}

/** Log a Tauri IPC call. Called from the bridge wrapper. */
export function logIpcCall(
  method: string,
  args: unknown,
  result: unknown,
  durationMs: number,
  error?: string,
) {
  const level: LogLevel = error ? "error" : "success";
  addEntry({
    id: `ipc-${++idCounter}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    level,
    method,
    url: `ipc://${method}`,
    statusCode: error ? 1 : 0,
    durationMs,
    errorMessage: error,
    requestData: args,
    responseData: result,
    source: "ipc",
  });
}

/** Log a user-initiated action (account added, config saved, etc.) */
export function logUserAction(action: string, data?: unknown) {
  addEntry({
    id: `user-${++idCounter}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    level: "success",
    method: "USER",
    url: action,
    statusCode: null,
    durationMs: 0,
    responseData: data,
    source: "system",
  });
}

/** Log a system event (startup, config change, etc.) */
export function logSystem(message: string, data?: unknown) {
  addEntry({
    id: `sys-${++idCounter}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    level: "info",
    method: "SYSTEM",
    url: message,
    statusCode: null,
    durationMs: 0,
    responseData: data,
    source: "system",
  });
}

/** Log an HTTP-level event (bridge server response, etc.) */
export function logHttp(
  method: string,
  url: string,
  status: number,
  durationMs: number,
  requestData?: unknown,
  responseData?: unknown,
  error?: string,
) {
  const level: LogLevel = error
    ? "error"
    : status >= 400
      ? "warning"
      : "success";
  addEntry({
    id: `http-${++idCounter}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    level,
    method,
    url,
    statusCode: status,
    durationMs,
    errorMessage: error,
    requestData,
    responseData,
    source: "http",
  });
}
