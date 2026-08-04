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
  detectedProtocol: Exclude<AccountProvider, "auto"> | null;
  baseUrl: string;
  apiKey: string;
  usageTags: AccountUsageTag[];
  isActive: boolean;
  lastUsedAt: string | null;
  models: string[];
  selectedModel: string;
  modelsLastRefreshedAt: string | null;
};

export type AccountProvider = "auto" | "openai-compatible" | "anthropic" | "gemini" | "ollama" | "cohere" | "v0";

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

export type RuntimeSnapshot = Pick<BridgeState, "stats" | "logs">;

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

export type PlaygroundThinkingMode = "auto" | "disabled" | "adaptive" | "enabled";
export type PlaygroundResponseFormat = "text" | "json_object";

export type PlaygroundTestInput = {
  baseUrl: string;
  apiKey: string;
  protocol: Exclude<AccountProvider, "auto" | "v0">;
  model: string;
  message: string;
  systemPrompt?: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  seed?: number;
  stopSequences: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  thinkingMode: PlaygroundThinkingMode;
  thinkingBudget?: number;
  responseFormat: PlaygroundResponseFormat;
  advancedBody?: Record<string, unknown>;
};

export type PlaygroundModelsInput = {
  baseUrl: string;
  apiKey: string;
  protocol?: AccountProvider;
};

export type PlaygroundTestResult = {
  ok: boolean;
  status: number;
  model: string;
  content: string;
  raw: unknown;
  request?: unknown;
  resolvedUrl?: string;
  error?: string;
};

export type PlaygroundModelsResult = {
  ok: boolean;
  status: number;
  models: string[];
  detectedProtocol?: Exclude<AccountProvider, "auto">;
  raw: unknown;
  error?: string;
};

export type ResetUsageInput = {
  confirm: boolean;
};
