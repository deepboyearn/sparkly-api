import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { app } from "electron";
import os from "node:os";
import { V0_BASE_URL, V0_MODELS } from "../shared/types";
import type { AccountProvider, BridgeConfig, ClientApiKey, UpstreamAccount } from "../shared/types";

const defaultAccountId = randomUUID();
const defaultLocalPort = 48231;

const defaultConfig: BridgeConfig = {
  upstreamBaseUrl: "https://api.bluesminds.com",
  apiKey: "",
  models: [
    "gpt-5",
    "gpt-5.1",
    "gpt-5.2",
    "gpt-5.4",
    "gpt-5.4-mini",
    "claude-haiku-4-5-20251001",
    "claude-haiku-4-5-20251001-thinking",
    "claude-opus-4-5",
    "claude-opus-4-6",
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-5-20250929-thinking",
    "claude-sonnet-4-6",
    "deepseek-chat",
    "deepseek-chat-search",
    "deepseek-expert-chat",
    "deepseek-expert-chat-search",
    "deepseek-expert-reasoner",
    "deepseek-expert-reasoner-search",
    "deepseek-reasoner",
    "deepseek-reasoner-search",
    "glm-4.7",
    "glm-5",
    "grok-4.20-0309",
    "grok-4.20-0309-non-reasoning",
    "grok-4.20-0309-reasoning",
    "grok-imagine-image-lite",
    "MiniMax-M2.5",
    "moonshotai/kimi-k2.5",
    "qwen/qwen3.6-plus",
    "qwen3.5-omni-plus",
    "qwen3.5-omni-plus-search",
    "qwen3.5-omni-plus-thinking",
    "qwen3.5-omni-plus-thinking-search",
    "qwen3.5-plus",
    "qwen3.5-plus-search",
    "qwen3.5-plus-thinking",
    "qwen3.5-plus-thinking-search",
    "qwen3.6-plus",
    "qwen3.6-plus-image-edit",
    "qwen3.6-plus-search",
    "qwen3.6-plus-thinking",
    "qwen3.6-plus-thinking-search",
  ],
  selectedModel: "gpt-5.4",
  localPort: defaultLocalPort,
  enableCors: true,
  systemPrompt: "",
  accounts: [
    {
      id: defaultAccountId,
      name: "Primary Account",
      provider: "openai-compatible",
      baseUrl: "https://api.bluesminds.com",
      apiKey: "",
      usageTags: ["coding"],
      isActive: true,
      lastUsedAt: null,
    },
  ],
  activeAccountId: defaultAccountId,
};

// ─── PATH HELPERS ─────────────────────────────────────────────────────────────
function getUserDataPath() {
  if (app) {
    try {
      return app.getPath("userData");
    } catch {
      // Fall through to the non-Electron path below.
    }
  }
  return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "sparkly-api");
}

function getConfigPath() {
  return path.join(getUserDataPath(), "bridge-config.json");
}

function getClientKeysPath() {
  return path.join(getUserDataPath(), "client-keys.json");
}

function getUsageLogsPath() {
  return path.join(getUserDataPath(), "usage-logs.json");
}

export function getResponsesDebugLogPath() {
  return path.join(getUserDataPath(), "responses-debug.jsonl");
}

export function loadUsageLogs() {
  const usagePath = getUsageLogsPath();
  if (!fs.existsSync(usagePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(usagePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveUsageLogs(logs: unknown[]) {
  fs.mkdirSync(path.dirname(getUsageLogsPath()), { recursive: true });
  fs.writeFileSync(getUsageLogsPath(), JSON.stringify(logs, null, 2), "utf8");
}

export function clearUsageLogs() {
  saveUsageLogs([]);
}

// ─── CLIENT KEYS ─────────────────────────────────────────────────────────────
function persistClientKeys(keys: ClientApiKey[]) {
  fs.mkdirSync(path.dirname(getClientKeysPath()), { recursive: true });
  fs.writeFileSync(getClientKeysPath(), JSON.stringify(keys, null, 2), "utf8");
}

function maskClientKey(key: string) {
  return `${key.slice(0, 9)}${"•".repeat(18)}${key.slice(-6)}`;
}

export function loadConfig(): BridgeConfig {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
    return normalizeConfig({
      ...defaultConfig,
      ...parsed,
    });
  } catch {
    return defaultConfig;
  }
}

export function saveConfig(config: BridgeConfig): BridgeConfig {
  const normalized = normalizeConfig(config);
  persistConfig(normalized);
  return normalized;
}

export function normalizeConfig(input: BridgeConfig): BridgeConfig {
  const models = Array.from(
    new Set(
      [...defaultConfig.models, ...input.models]
        .map((item) => item.trim())
        .filter((item) => Boolean(item) && !/codex/i.test(item)),
    ),
  );
  const accounts = normalizeAccounts(input.accounts, input.upstreamBaseUrl, input.apiKey, input.activeAccountId);
  const activeAccountId = accounts.find((account) => account.id === input.activeAccountId)?.id ?? accounts[0]?.id ?? "";
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? accounts[0];
  const selectedModel = models.includes(input.selectedModel)
    ? input.selectedModel
    : models.includes(defaultConfig.selectedModel)
      ? defaultConfig.selectedModel
      : models[0] ?? "";

  return {
    upstreamBaseUrl: activeAccount?.baseUrl ?? input.upstreamBaseUrl.trim().replace(/\/$/, ""),
    apiKey: activeAccount?.apiKey ?? input.apiKey.trim(),
    models,
    selectedModel,
    localPort: Number.isFinite(input.localPort) ? Math.max(10000, Math.min(65535, input.localPort)) : defaultLocalPort,
    enableCors: Boolean(input.enableCors),
    systemPrompt: input.systemPrompt.trim(),
    accounts,
    activeAccountId,
  };
}

function normalizeAccounts(accounts: UpstreamAccount[] | undefined, fallbackBaseUrl: string, fallbackApiKey: string, activeAccountId: string) {
  const source = Array.isArray(accounts) ? accounts : [];

  if (source.length === 0) {
    return [];
  }

  const normalized: UpstreamAccount[] = source.map((account, index) => {
    const provider = normalizeAccountProvider((account as Partial<UpstreamAccount>).provider);
    return {
      id: account.id || randomUUID(),
      name: account.name.trim() || (provider === "v0" ? "v0" : `Account ${index + 1}`),
      provider,
      baseUrl: account.baseUrl.trim().replace(/\/$/, "") || (provider === "v0" ? V0_BASE_URL : defaultConfig.upstreamBaseUrl),
      apiKey: account.apiKey.trim(),
      usageTags: ["coding"],
      isActive: account.id === activeAccountId || (!activeAccountId && index === 0),
      lastUsedAt: account.lastUsedAt ?? null,
    };
  });

  if (!normalized.some((account) => account.isActive) && normalized[0]) {
    normalized[0].isActive = true;
  }

  return normalized;
}

function normalizeAccountProvider(provider: unknown): AccountProvider {
  return provider === "v0" ? "v0" : "openai-compatible";
}

function persistConfig(config: BridgeConfig) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
}

export function createAccount(input: { name: string; provider: AccountProvider; baseUrl: string; apiKey: string; usageTags: Array<"coding"> }) {
  const config = loadConfig();
  const provider = normalizeAccountProvider(input.provider);
  const nextAccount: UpstreamAccount = {
    id: randomUUID(),
    name: input.name.trim() || (provider === "v0" ? "v0" : `Account ${config.accounts.length + 1}`),
    provider,
    baseUrl: input.baseUrl.trim().replace(/\/$/, "") || (provider === "v0" ? V0_BASE_URL : config.upstreamBaseUrl),
    apiKey: input.apiKey.trim(),
    usageTags: ["coding"],
    isActive: config.accounts.length === 0,
    lastUsedAt: null,
  };

  return saveConfig({
    ...config,
    accounts: [...config.accounts, nextAccount],
    activeAccountId: config.activeAccountId || nextAccount.id,
  });
}

export function updateAccount(input: { id: string; name: string; provider: AccountProvider; baseUrl: string; apiKey: string; usageTags: Array<"coding">; isActive: boolean }) {
  const config = loadConfig();
  const provider = normalizeAccountProvider(input.provider);
  const accounts: UpstreamAccount[] = config.accounts.map((account) => {
    if (account.id !== input.id) {
      return {
        ...account,
        isActive: input.isActive ? false : account.isActive,
      };
    }

    return {
      ...account,
      name: input.name.trim() || account.name,
      provider,
      baseUrl: input.baseUrl.trim().replace(/\/$/, "") || (provider === "v0" ? V0_BASE_URL : account.baseUrl),
      apiKey: input.apiKey.trim() || account.apiKey,
      usageTags: ["coding"],
      isActive: input.isActive,
    };
  });

  const activeAccountId = input.isActive ? input.id : config.activeAccountId;
  return saveConfig({ ...config, accounts, activeAccountId });
}

export function deleteAccount(id: string) {
  const config = loadConfig();
  const accounts = config.accounts.filter((account) => account.id !== id);
  const activeAccountId = accounts.find((account) => account.isActive)?.id ?? accounts[0]?.id ?? "";
  return saveConfig({ ...config, accounts, activeAccountId });
}

export function selectActiveAccount(id: string) {
  const config = loadConfig();
  const accounts = config.accounts.map((account) => ({
    ...account,
    isActive: account.id === id,
  }));
  return saveConfig({ ...config, accounts, activeAccountId: id });
}

export function markAccountUsed(id: string) {
  const config = loadConfig();
  const accounts = config.accounts.map((account) => account.id === id ? { ...account, lastUsedAt: new Date().toISOString() } : account);
  persistConfig({ ...config, accounts });
}

export function getV0Models() {
  return [...V0_MODELS];
}

export function loadClientKeys(): ClientApiKey[] {
  const keysPath = getClientKeysPath();

  if (!fs.existsSync(keysPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(keysPath, "utf8");
    const parsed = JSON.parse(raw) as ClientApiKey[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createClientKey(name: string): ClientApiKey[] {
  const existing = loadClientKeys();
  const cleanName = name.trim() || `Key ${existing.length + 1}`;
  const rawKey = `sk-${randomBytes(32).toString("hex")}`;
  const nextKey: ClientApiKey = {
    id: randomUUID(),
    name: cleanName,
    key: rawKey,
    maskedKey: maskClientKey(rawKey),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    isActive: true,
  };

  const updated = [nextKey, ...existing].slice(0, 10);
  persistClientKeys(updated);
  return updated;
}

export function updateClientKey(id: string, name: string): ClientApiKey[] {
  const updated = loadClientKeys().map((item) => {
    if (item.id !== id) {
      return item;
    }

    return {
      ...item,
      name: name.trim() || item.name,
    };
  });

  persistClientKeys(updated);
  return updated;
}

export function deleteClientKey(id: string): ClientApiKey[] {
  const updated = loadClientKeys().filter((item) => item.id !== id);
  persistClientKeys(updated);
  return updated;
}
