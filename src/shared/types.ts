export type RequestLogEntry = {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  model?: string;
  durationMs: number;
  error?: string;
  requestType?: "model_probe" | "chat" | "responses";
};

export type BridgeConfig = {
  upstreamBaseUrl: string;
  apiKey: string;
  models: string[];
  selectedModel: string;
  localPort: number;
  enableCors: boolean;
  systemPrompt: string;
  accounts: UpstreamAccount[];
  activeAccountId: string;
};

export type UpstreamAccount = {
  id: string;
  name: string;
  provider: AccountProvider;
  baseUrl: string;
  apiKey: string;
  usageTags: AccountUsageTag[];
  isActive: boolean;
  lastUsedAt: string | null;
};

export type AccountProvider = "openai-compatible" | "v0" | "anthropic";

export type AccountUsageTag = "coding";

export const V0_BASE_URL = "https://api.v0.dev/v1";

export const V0_MODELS = ["v0-auto", "v0-mini", "v0-pro", "v0-max", "v0-max-fast"] as const;

export type ClientApiKey = {
  id: string;
  name: string;
  key: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt: string | null;
  isActive: boolean;
};

export type BridgeStats = {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  lastRequestAt: string | null;
  uptimeMs: number;
  activeModelCount: number;
  localBaseUrl: string;
  serverRunning: boolean;
};

export type BridgeState = {
  config: BridgeConfig;
  stats: BridgeStats;
  logs: RequestLogEntry[];
  clientKeys: ClientApiKey[];
};

export type SaveConfigInput = BridgeConfig;

export type CreateClientKeyInput = {
  name: string;
};

export type UpdateClientKeyInput = {
  id: string;
  name: string;
};

export type DeleteClientKeyInput = {
  id: string;
};

export type CreateAccountInput = {
  name: string;
  provider: AccountProvider;
  baseUrl: string;
  apiKey: string;
  usageTags: AccountUsageTag[];
};

export type UpdateAccountInput = {
  id: string;
  name: string;
  provider: AccountProvider;
  baseUrl: string;
  apiKey: string;
  usageTags: AccountUsageTag[];
  isActive: boolean;
};

export type DeleteAccountInput = {
  id: string;
};

export type SelectAccountInput = {
  id: string;
};

export type PlaygroundTestInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  message: string;
  systemPrompt?: string;
};

export type PlaygroundModelsInput = {
  baseUrl: string;
  apiKey: string;
};

export type PlaygroundTestResult = {
  ok: boolean;
  status: number;
  model: string;
  content: string;
  raw: unknown;
  error?: string;
};

export type PlaygroundModelsResult = {
  ok: boolean;
  status: number;
  models: string[];
  raw: unknown;
  error?: string;
};

export type ResetUsageInput = {
  confirm: boolean;
};
