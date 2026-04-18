import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { app } from "electron";
import os from "node:os";
import type { ActivateLicenseInput, BridgeConfig, ClientApiKey, LicenseEnvelope, LicenseState, UpstreamAccount } from "../shared/types";

const defaultAccountId = randomUUID();
const defaultLocalPort = 48231;

const defaultConfig: BridgeConfig = {
  upstreamBaseUrl: "https://api.souimagery.fun",
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
    "qwen3.6-plus-thinking-search"
  ],
  selectedModel: "gpt-5.4",
  localPort: defaultLocalPort,
  enableCors: true,
  systemPrompt: "",
  accounts: [
    {
      id: defaultAccountId,
      name: "Primary Account",
      baseUrl: "https://api.souimagery.fun",
      apiKey: "",
      isActive: true,
      lastUsedAt: null,
    },
  ],
  activeAccountId: defaultAccountId,
};

const LICENSE_SECRET = "local-ai-bridge-license-secret-v1";

function getUserDataPath() {
  if (app) {
    try {
      return app.getPath("userData");
    } catch {
      // Fall through to the non-Electron path below.
    }
  }

  return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "local-ai-bridge");
}

function getConfigPath() {
  return path.join(getUserDataPath(), "bridge-config.json");
}

function getClientKeysPath() {
  return path.join(getUserDataPath(), "client-keys.json");
}

function getLicensePath() {
  return path.join(getUserDataPath(), "license.json");
}

function getLicenseRequestPath() {
  return path.join(getUserDataPath(), "license-request.txt");
}

export function getResponsesDebugLogPath() {
  return path.join(getUserDataPath(), "responses-debug.jsonl");
}

function getDefaultLicenseState(message = "No license installed."): LicenseState {
  return {
    status: "missing",
    installedLicense: null,
    requestCode: loadOrCreateRequestCode(),
    customerName: null,
    customerEmail: null,
    plan: null,
    expiresAt: null,
    seats: 0,
    offlineGraceDays: 0,
    features: [],
    message,
    lastValidatedAt: null,
  };
}

function createLicenseSignature(payload: LicenseEnvelope["payload"]) {
  return createHash("sha256").update(`${JSON.stringify(payload)}:${LICENSE_SECRET}`).digest("base64url");
}

function decodeLicenseKey(raw: string) {
  const normalized = raw.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function createRequestCode() {
  return `REQ-${randomBytes(9).toString("hex").toUpperCase()}`;
}

function loadOrCreateRequestCode() {
  const requestPath = getLicenseRequestPath();
  if (fs.existsSync(requestPath)) {
    const existing = fs.readFileSync(requestPath, "utf8").trim();
    if (existing) {
      return existing;
    }
  }

  const code = createRequestCode();
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  fs.writeFileSync(requestPath, code, "utf8");
  return code;
}

export function regenerateRequestCode() {
  const requestPath = getLicenseRequestPath();
  const code = createRequestCode();
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  fs.writeFileSync(requestPath, code, "utf8");
  return code;
}

function persistLicense(license: LicenseEnvelope) {
  fs.mkdirSync(path.dirname(getLicensePath()), { recursive: true });
  fs.writeFileSync(getLicensePath(), JSON.stringify(license, null, 2), "utf8");
}

function readInstalledLicense() {
  const licensePath = getLicensePath();
  if (!fs.existsSync(licensePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(licensePath, "utf8");
    return JSON.parse(raw) as LicenseEnvelope;
  } catch {
    return null;
  }
}

function verifyLicenseEnvelope(license: LicenseEnvelope | null): LicenseState {
  if (!license?.payload || typeof license.signature !== "string" || !license.signature.trim()) {
    return getDefaultLicenseState("License file is missing or malformed.");
  }

  const isValid = createLicenseSignature(license.payload) === license.signature;
  if (!isValid) {
    return {
      ...getDefaultLicenseState("License signature validation failed."),
      status: "invalid",
      installedLicense: license,
      lastValidatedAt: new Date().toISOString(),
    };
  }

  const expiresAt = typeof license.payload.expiresAt === "string" ? license.payload.expiresAt : "";
  const isExpired = !expiresAt || Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) < Date.now();
  const currentRequestCode = loadOrCreateRequestCode();
  if (license.payload.requestCode !== currentRequestCode) {
    return {
      ...getDefaultLicenseState("This activation code was generated for another installation."),
      status: "invalid",
      installedLicense: license,
      lastValidatedAt: new Date().toISOString(),
    };
  }

  return {
    status: isExpired ? "expired" : "active",
    installedLicense: license,
    requestCode: currentRequestCode,
    customerName: license.payload.customerName,
    customerEmail: license.payload.customerEmail,
    plan: license.payload.plan,
    expiresAt: license.payload.expiresAt,
    seats: Number.isFinite(license.payload.seats) ? license.payload.seats : 0,
    offlineGraceDays: Number.isFinite(license.payload.offlineGraceDays) ? license.payload.offlineGraceDays : 0,
    features: Array.isArray(license.payload.features) ? license.payload.features.filter((item) => typeof item === "string") : [],
    message: isExpired ? "Installed license has expired." : "License is active.",
    lastValidatedAt: new Date().toISOString(),
  };
}

export function loadLicenseState() {
  return verifyLicenseEnvelope(readInstalledLicense());
}

export function activateLicense(input: ActivateLicenseInput) {
  const trimmed = input.licenseKey.trim();
  if (!trimmed) {
    return getDefaultLicenseState("License key is required.");
  }

  try {
    const parsed = JSON.parse(decodeLicenseKey(trimmed)) as LicenseEnvelope;
    const state = verifyLicenseEnvelope(parsed);
    if (state.status === "active" || state.status === "expired") {
      persistLicense(parsed);
    }
    return state;
  } catch {
    return {
      ...getDefaultLicenseState("License key format is invalid."),
      status: "invalid",
      lastValidatedAt: new Date().toISOString(),
    };
  }
}

export function clearLicense() {
  const licensePath = getLicensePath();
  if (fs.existsSync(licensePath)) {
    fs.unlinkSync(licensePath);
  }
  return getDefaultLicenseState();
}

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
  const source = Array.isArray(accounts) && accounts.length > 0
    ? accounts
    : [
        {
          id: defaultAccountId,
          name: "Primary Account",
          baseUrl: fallbackBaseUrl || defaultConfig.upstreamBaseUrl,
          apiKey: fallbackApiKey || defaultConfig.apiKey,
          isActive: true,
          lastUsedAt: null,
        },
      ];

  const normalized = source.map((account, index) => ({
    id: account.id || randomUUID(),
    name: account.name.trim() || `Account ${index + 1}`,
    baseUrl: account.baseUrl.trim().replace(/\/$/, "") || defaultConfig.upstreamBaseUrl,
    apiKey: account.apiKey.trim(),
    isActive: account.id === activeAccountId || (!activeAccountId && index === 0),
    lastUsedAt: account.lastUsedAt ?? null,
  }));

  if (!normalized.some((account) => account.isActive) && normalized[0]) {
    normalized[0].isActive = true;
  }

  return normalized;
}

function persistConfig(config: BridgeConfig) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
}

export function createAccount(input: { name: string; baseUrl: string; apiKey: string }) {
  const config = loadConfig();
  const nextAccount: UpstreamAccount = {
    id: randomUUID(),
    name: input.name.trim() || `Account ${config.accounts.length + 1}`,
    baseUrl: input.baseUrl.trim().replace(/\/$/, "") || config.upstreamBaseUrl,
    apiKey: input.apiKey.trim(),
    isActive: config.accounts.length === 0,
    lastUsedAt: null,
  };

  return saveConfig({
    ...config,
    accounts: [...config.accounts, nextAccount],
    activeAccountId: config.activeAccountId || nextAccount.id,
  });
}

export function updateAccount(input: { id: string; name: string; baseUrl: string; apiKey: string; isActive: boolean }) {
  const config = loadConfig();
  const accounts = config.accounts.map((account) => {
    if (account.id !== input.id) {
      return {
        ...account,
        isActive: input.isActive ? false : account.isActive,
      };
    }

    return {
      ...account,
      name: input.name.trim() || account.name,
      baseUrl: input.baseUrl.trim().replace(/\/$/, "") || account.baseUrl,
      apiKey: input.apiKey.trim() || account.apiKey,
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
