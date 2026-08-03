import type { BridgeConfig, BridgeState, PlaygroundTestResult } from "../../shared/types";

function shallowEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

export const emptyState: BridgeState = {
  config: {
    upstreamBaseUrl: "https://cn.chrouter.com:8443",
    apiKey: "",
    models: [],
    selectedModel: "gpt-5.4",
    localPort: 48231,
    enableCors: true,
    systemPrompt: "",
    accounts: [],
    activeAccountId: "",
  },
  stats: {
    totalRequests: 0,
    successCount: 0,
    errorCount: 0,
    lastRequestAt: null,
    uptimeMs: 0,
    activeModelCount: 0,
    localBaseUrl: "http://localhost:48231",
    serverRunning: false,
  },
  logs: [],
  clientKeys: [],
};

export function normalizeBridgeState(input: Partial<BridgeState>, prev?: BridgeState): BridgeState {
  const config = { ...emptyState.config, ...input.config };
  const stats = { ...emptyState.stats, ...input.stats };
  const logs = Array.isArray(input.logs) ? [...input.logs] : [];
  const clientKeys = Array.isArray(input.clientKeys) ? [...input.clientKeys] : [];

  // Skip re-render if data is identical
  if (prev &&
      shallowEqual(config, prev.config) &&
      shallowEqual(stats, prev.stats) &&
      logs.length === prev.logs.length &&
      logs[0]?.id === prev.logs[0]?.id &&
      clientKeys.length === prev.clientKeys.length &&
      clientKeys[0]?.id === prev.clientKeys[0]?.id) {
    return prev; // Same reference = no re-render
  }

  return { config, stats, logs, clientKeys };
}

export function parseModels(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatUptime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function getRequestPoints(logs: BridgeState["logs"]) {
  const points = [];
  const now = new Date();
  
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600000);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    
    const label = `${mm}-${dd} ${hh}:00`;
    const count = logs.filter(log => {
      const logDate = new Date(log.timestamp);
      return logDate.getHours() === d.getHours() && 
             logDate.getDate() === d.getDate() &&
             logDate.getMonth() === d.getMonth();
    }).length;
    
    points.push({ label, value: count });
  }
  return points;
}

export function maskKey(value: string) {
  if (!value) {
    return "Not set";
  }

  if (value.length <= 8) {
    return "Configured";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function copyModelPayload(baseUrl: string, model: string) {
  return navigator.clipboard.writeText(JSON.stringify({ baseUrl: `${baseUrl}/v1`, model }, null, 2));
}

export function normalizeOpenAiBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function getPlaygroundErrorSummary(result: PlaygroundTestResult | null) {
  if (!result || result.ok) {
    return null;
  }

  if (typeof result.raw === "object" && result.raw !== null) {
    const rawError = (result.raw as { error?: { message?: string } }).error?.message;
    if (rawError) {
      return `${result.status} ${rawError}`;
    }
  }

  if (result.error) {
    return `${result.status} ${result.error}`;
  }

  return `${result.status} Request failed`;
}

export function ensureBridgeMethod<T extends keyof Window["bridgeApi"]>(method: T) {
  const candidate = window.bridgeApi?.[method];
  if (typeof candidate !== "function") {
    throw new Error(`Bridge runtime is outdated. Please fully restart the Electron app to load ${String(method)}.`);
  }
  return candidate;
}

export function getHourlyPoints(logs: BridgeState["logs"], type: "requests" | "tokens", count: number = 24) {
  const points = [];
  const now = new Date();
  
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600000);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    
    const label = `${mm}-${dd} ${hh}:00`;
    const matchingLogs = logs.filter((entry) => {
      const logDate = new Date(entry.timestamp);
      return logDate.getHours() === d.getHours() && 
             logDate.getDate() === d.getDate() &&
             logDate.getMonth() === d.getMonth();
    });

    const value = type === "requests"
      ? matchingLogs.length
      : matchingLogs.reduce((total, entry) => total + Math.max(60, entry.durationMs * 3), 0);

    points.push({ label, value });
  }
  return points;
}
export function getDayPoints(logs: BridgeState["logs"], type: "requests" | "tokens", count: number = 14) {
  const points = [];
  const now = new Date();
  
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const label = `${mm}-${dd} 00:00`;

    const matchingLogs = logs.filter((entry) => {
      const logDate = new Date(entry.timestamp);
      return logDate.getDate() === d.getDate() &&
             logDate.getMonth() === d.getMonth() &&
             logDate.getFullYear() === d.getFullYear();
    });

    const value = type === "requests"
      ? matchingLogs.length
      : matchingLogs.reduce((total, entry) => total + Math.max(60, entry.durationMs * 3), 0);

    points.push({ label, value });
  }
  return points;
}

export function groupModelStats(logs: BridgeState["logs"]) {
  const map = new Map<string, { requests: number; tokens: number; cost: number }>();

  for (const entry of logs) {
    const key = entry.model ?? "unknown";
    const current = map.get(key) ?? { requests: 0, tokens: 0, cost: 0 };
    current.requests += 1;
    current.tokens += Math.max(60, entry.durationMs * 3);
    current.cost += Math.max(0.001, entry.durationMs / 100000);
    map.set(key, current);
  }

  return Array.from(map.entries()).map(([model, value]) => ({ model, ...value }));
}

export function groupKeyStats(logs: BridgeState["logs"], clientKeys: BridgeState["clientKeys"]) {
  if (clientKeys.length === 0) {
    return [];
  }

  return clientKeys.map((key) => {
    const requests = logs.length;
    const tokens = logs.reduce((total, entry) => total + Math.max(60, entry.durationMs * 3), 0);
    const cost = logs.reduce((total, entry) => total + Math.max(0.001, entry.durationMs / 100000), 0);

    return {
      id: key.id,
      name: key.name,
      maskedKey: key.maskedKey,
      requests,
      tokens,
      cost,
    };
  });
}

export function getUsageRecords(logs: BridgeState["logs"], clientKeys: BridgeState["clientKeys"], upstreamApiKey: string) {
  const fallbackKey = clientKeys[0]?.maskedKey ?? maskKey(upstreamApiKey);

  return logs.map((entry) => {
    const estimatedTokens = Math.max(60, entry.durationMs * 3);
    const tps = Math.max(1, Math.round(estimatedTokens / Math.max(1, entry.durationMs / 1000)));
    const amountSpent = Math.max(0.001, entry.durationMs / 100000);
    const source = entry.path.includes("chat/completions") ? "chat.completions" : entry.path.replace(/^\//, "");

    return {
      id: entry.id,
      time: new Date(entry.timestamp).toLocaleString(),
      model: entry.model ?? "-",
      tokens: estimatedTokens,
      tps,
      responseTime: `${entry.durationMs} ms`,
      status: entry.status,
      source,
      ip: "localhost",
      apiKey: fallbackKey,
      amountSpent: `$${amountSpent.toFixed(3)}`,
      balanceChange: `-${Math.round(amountSpent * 1000)} pts`,
      requestId: entry.id.slice(0, 8),
      requestType: entry.requestType,
    };
  });
}

export type SectionKey = "overview" | "apiKeys" | "usage" | "accounts" | "playground";

export type AppViewModel = {
  state: BridgeState;
  form: BridgeConfig;
  modelsInput: string;
  overviewModelQuery: string;
  apiKeyModelQuery: string;
  usageMode: "statistics" | "records";
  playgroundModelQuery: string;
  playgroundBaseUrl: string;
  playgroundApiKey: string;
  playgroundModel: string;
  playgroundSystemPrompt: string;
  playgroundMessage: string;
  playgroundResult: PlaygroundTestResult | null;
  playgroundLoading: boolean;
  saving: boolean;
};
