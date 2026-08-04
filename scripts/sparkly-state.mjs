import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const IDENTIFIER = "com.sparklyapi.sparklyapi";
export function defaultDataDir() {
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), IDENTIFIER);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", IDENTIFIER);
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), IDENTIFIER);
}

function paths(dataDir) {
  return {
    config: path.join(dataDir, "bridge-config.json"),
    keys: path.join(dataDir, "client-keys.json"),
    lock: path.join(dataDir, ".sparkly-cli.lock"),
  };
}

function defaultConfig() {
  return {
    upstreamBaseUrl: "https://api.bluesminds.com",
    apiKey: "",
    models: [],
    selectedModel: "",
    localPort: 48231,
    enableCors: false,
    systemPrompt: "",
    accounts: [],
    activeAccountId: "",
  };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(fallback);
    throw new Error(`Could not read ${file}: ${error.message}`, { cause: error });
  }
}

function normalizeConfig(input) {
  const base = { ...defaultConfig(), ...(input && typeof input === "object" ? input : {}) };
  const legacyModels = [...new Set((Array.isArray(base.models) ? base.models : [])
    .map((value) => String(value).trim()).filter(Boolean))];
  base.localPort = 48231;
  base.enableCors = Boolean(base.enableCors);
  base.systemPrompt = String(base.systemPrompt ?? "").trim();
  base.accounts = (Array.isArray(base.accounts) ? base.accounts : []).map((account, index) => ({
    id: String(account?.id || randomUUID()),
    name: String(account?.name || `Account ${index + 1}`).trim(),
    provider: ["auto", "openai-compatible", "anthropic", "gemini", "ollama", "cohere", "v0"].includes(account?.provider) ? account.provider : "auto",
    detectedProtocol: ["openai-compatible", "anthropic", "gemini", "ollama", "cohere", "v0"].includes(account?.detectedProtocol) ? account.detectedProtocol : null,
    baseUrl: String(account?.baseUrl ?? "").trim().replace(/\/+$/, ""),
    apiKey: String(account?.apiKey ?? "").trim(),
    usageTags: ["coding"],
    isActive: false,
    lastUsedAt: account?.lastUsedAt ?? null,
    models: [...new Set((Array.isArray(account?.models) ? account.models : []).map((model) => String(model).trim()).filter(Boolean))],
    selectedModel: String(account?.selectedModel ?? "").trim(),
    modelsLastRefreshedAt: account?.modelsLastRefreshedAt ?? null,
  }));
  const active = base.accounts.find((account) => account.id === base.activeAccountId) ?? base.accounts[0];
  base.activeAccountId = active?.id ?? "";
  for (const account of base.accounts) account.isActive = account.id === base.activeAccountId;
  if (active) {
    if (active.models.length === 0 && legacyModels.length > 0) active.models = legacyModels;
    if (!active.models.includes(active.selectedModel)) active.selectedModel = active.models[0] ?? "";
    base.models = active.models;
    base.selectedModel = active.selectedModel;
    base.upstreamBaseUrl = active.baseUrl;
    base.apiKey = active.apiKey;
  } else {
    base.upstreamBaseUrl = String(base.upstreamBaseUrl ?? "").trim().replace(/\/+$/, "");
    base.apiKey = String(base.apiKey ?? "").trim();
  }
  if (!active) {
    base.models = legacyModels;
    if (!base.models.includes(base.selectedModel)) base.selectedModel = base.models[0] ?? "";
  }
  return base;
}

function mask(value) {
  const text = String(value ?? "");
  if (!text) return "";
  if (text.length <= 10) return `${text.slice(0, 2)}••••${text.slice(-2)}`;
  return `${text.slice(0, 6)}${"•".repeat(12)}${text.slice(-4)}`;
}

export function redactState(value, reveal = false) {
  if (reveal) return value;
  if (Array.isArray(value)) return value.map((item) => redactState(item, false));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(apiKey|key)$/i.test(key)) output[key] = mask(item);
    else output[key] = redactState(item, false);
  }
  return output;
}

async function acquireLock(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const target = paths(dataDir).lock;
  try {
    const handle = await open(target, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    await handle.close();
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Another Sparkly CLI mutation owns ${target}.`);
    throw error;
  }
  return async () => unlink(target).catch((error) => { if (error?.code !== "ENOENT") throw error; });
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const backup = `${file}.${process.pid}.${randomUUID()}.bak`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600).catch(() => {});
  try {
    await rename(temporary, file);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    let backedUp = false;
    try {
      await rename(file, backup);
      backedUp = true;
      await rename(temporary, file);
      await rm(backup, { force: true });
    } catch (replacementError) {
      if (backedUp) await rename(backup, file).catch(() => {});
      throw replacementError;
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function loadState(dataDir = defaultDataDir()) {
  const target = paths(dataDir);
  const [config, keys] = await Promise.all([
    readJson(target.config, defaultConfig()),
    readJson(target.keys, []),
  ]);
  return { dataDir, config: normalizeConfig(config), clientKeys: Array.isArray(keys) ? keys : [] };
}

export async function mutateState(dataDir, mutation) {
  const release = await acquireLock(dataDir);
  try {
    const state = await loadState(dataDir);
    const result = await mutation(state);
    state.config = normalizeConfig(state.config);
    state.clientKeys = state.clientKeys.slice(0, 10);
    const target = paths(dataDir);
    await atomicJson(target.config, state.config);
    await atomicJson(target.keys, state.clientKeys);
    return { state, result, reloadRequired: true };
  } finally {
    await release();
  }
}

export function addAccount(state, { name, provider, baseUrl, apiKey }) {
  if (!baseUrl?.trim()) throw new Error("Account base URL is required.");
  const account = {
    id: randomUUID(),
    name: String(name || `Account ${state.config.accounts.length + 1}`).trim(),
    provider: ["auto", "openai-compatible", "anthropic", "gemini", "ollama", "cohere", "v0"].includes(provider) ? provider : "auto",
    detectedProtocol: null,
    baseUrl: baseUrl.trim().replace(/\/+$/, ""),
    apiKey: String(apiKey ?? "").trim(),
    usageTags: ["coding"],
    isActive: state.config.accounts.length === 0,
    lastUsedAt: null,
    models: provider === "v0" ? ["v0-auto", "v0-mini", "v0-pro", "v0-max", "v0-max-fast"] : [],
    selectedModel: provider === "v0" ? "v0-auto" : "",
    modelsLastRefreshedAt: null,
  };
  state.config.accounts.push(account);
  if (!state.config.activeAccountId) state.config.activeAccountId = account.id;
  return account;
}

export function selectAccount(state, id) {
  if (!state.config.accounts.some((account) => account.id === id)) throw new Error(`Account not found: ${id}`);
  state.config.activeAccountId = id;
  return state.config.accounts.find((account) => account.id === id);
}

export function removeAccount(state, id) {
  const before = state.config.accounts.length;
  state.config.accounts = state.config.accounts.filter((account) => account.id !== id);
  if (state.config.accounts.length === before) throw new Error(`Account not found: ${id}`);
  if (state.config.activeAccountId === id) state.config.activeAccountId = state.config.accounts[0]?.id ?? "";
  return { id, removed: true };
}

export function setConfig(state, key, value) {
  const setters = {
    selectedModel: () => String(value),
    systemPrompt: () => String(value),
    enableCors: () => {
      if (!['true', 'false'].includes(String(value).toLowerCase())) throw new Error("enableCors must be true or false.");
      return String(value).toLowerCase() === 'true';
    },
  };
  if (!setters[key]) throw new Error("Mutable config keys: selectedModel, systemPrompt, enableCors. Provider credentials belong to accounts.");
  state.config[key] = setters[key]();
  return { key, value: state.config[key] };
}

export function createClientKey(state, name) {
  const key = `sk-${randomBytes(32).toString("hex")}`;
  const record = {
    id: randomUUID(),
    name: String(name || `Key ${state.clientKeys.length + 1}`).trim(),
    key,
    maskedKey: `${key.slice(0, 9)}${"•".repeat(18)}${key.slice(-6)}`,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    isActive: true,
  };
  state.clientKeys.unshift(record);
  return record;
}

export function setClientKeyActive(state, id, active) {
  const key = state.clientKeys.find((item) => item.id === id);
  if (!key) throw new Error(`Client key not found: ${id}`);
  key.isActive = active;
  return key;
}

export function removeClientKey(state, id) {
  const before = state.clientKeys.length;
  state.clientKeys = state.clientKeys.filter((item) => item.id !== id);
  if (state.clientKeys.length === before) throw new Error(`Client key not found: ${id}`);
  return { id, removed: true };
}
