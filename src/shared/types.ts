export type RequestLogEntry = {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  model?: string;
  durationMs: number;
  error?: string;
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
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  lastUsedAt: string | null;
};

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
  license: LicenseState;
};

export type LicensePayload = {
  licenseId: string;
  customerName: string;
  customerEmail: string;
  plan: string;
  seats: number;
  issuedAt: string;
  expiresAt: string;
  offlineGraceDays: number;
  features: string[];
  requestCode?: string;
};

export type LicenseEnvelope = {
  payload: LicensePayload;
  signature: string;
};

export type LicenseStatus = "missing" | "active" | "expired" | "invalid";

export type LicenseState = {
  status: LicenseStatus;
  installedLicense: LicenseEnvelope | null;
  requestCode: string;
  customerName: string | null;
  customerEmail: string | null;
  plan: string | null;
  expiresAt: string | null;
  seats: number;
  offlineGraceDays: number;
  features: string[];
  message: string;
  lastValidatedAt: string | null;
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
  baseUrl: string;
  apiKey: string;
};

export type UpdateAccountInput = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
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

export type ActivateLicenseInput = {
  licenseKey: string;
};

export type GenerateRequestCodeInput = {
  refresh?: boolean;
};

export type ClearLicenseInput = {
  confirm: boolean;
};
