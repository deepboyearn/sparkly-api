import path from "node:path";
import { app, BrowserWindow, Menu, ipcMain, shell } from "electron";
import { BridgeServer } from "./bridgeServer";
import { clearUsageLogs, createAccount, createClientKey, deleteAccount, deleteClientKey, loadClientKeys, loadConfig, saveConfig, selectActiveAccount, updateAccount, updateClientKey } from "./configStore";
import { V0_MODELS } from "../shared/types";
import type { BridgeConfig, BridgeState, CreateAccountInput, CreateClientKeyInput, DeleteAccountInput, DeleteClientKeyInput, PlaygroundModelsInput, PlaygroundModelsResult, PlaygroundTestInput, PlaygroundTestResult, ResetUsageInput, SaveConfigInput, SelectAccountInput, UpdateAccountInput, UpdateClientKeyInput } from "../shared/types";

const bridgeServer = new BridgeServer();
const logoPath = path.join(app.getAppPath(), "src", "logo", "logp.ico");
const useLocalhostBridge = process.env.SPARKLY_USE_LOCALHOST_BRIDGE === "1";

function normalizeOpenAiBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function extractHtmlTitle(html: string) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  return titleMatch?.[1]?.trim() ?? "";
}

function summarizePlaygroundFailure(status: number, raw: unknown, text: string) {
  if (typeof raw === "object" && raw !== null) {
    const providerMessage = (raw as { error?: { message?: string } }).error?.message;
    if (providerMessage) {
      return providerMessage;
    }
  }

  const lowered = text.toLowerCase();
  if (lowered.includes("error code 520") || lowered.includes("web server is returning an unknown error")) {
    return "Cloudflare 520: origin server returned an unknown error";
  }

  const title = extractHtmlTitle(text);
  if (title) {
    return title;
  }

  return `HTTP ${status} request failed`;
}

function extractModelsFromResponse(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  return ((raw as { data?: Array<{ id?: unknown }> }).data ?? [])
    .flatMap((item) => typeof item?.id === "string" ? [item.id] : []);
}

async function loadModelsFromProvider(input: PlaygroundModelsInput): Promise<PlaygroundModelsResult> {
  try {
    const normalizedBaseUrl = normalizeOpenAiBaseUrl(input.baseUrl);
    const response = await fetch(`${normalizedBaseUrl}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: AbortSignal.timeout(8_000),
    });

    const text = await response.text();
    let raw: unknown = text;

    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = text;
    }

    return {
      ok: response.ok,
      status: response.status,
      models: extractModelsFromResponse(raw),
      raw,
      error: response.ok ? undefined : summarizePlaygroundFailure(response.status, raw, text),
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      models: [],
      raw: null,
      error: error instanceof Error ? error.message : "Unknown model loading error",
    };
  }
}

async function syncActiveAccountModels(config: BridgeConfig) {
  const activeAccount = config.accounts.find((account) => account.id === config.activeAccountId) ?? config.accounts[0];
  if (!activeAccount?.baseUrl || !activeAccount.apiKey) {
    return config;
  }

  if (activeAccount.provider === "v0") {
    const models = [...V0_MODELS];
    return saveConfig({
      ...config,
      models,
      selectedModel: models.includes(config.selectedModel as typeof V0_MODELS[number]) ? config.selectedModel : models[0],
    });
  }

  const result = await loadModelsFromProvider({
    baseUrl: activeAccount.baseUrl,
    apiKey: activeAccount.apiKey,
  });

  if (!result.ok || result.models.length === 0) {
    return config;
  }

  return saveConfig({
    ...config,
    models: result.models,
    selectedModel: result.models.includes(config.selectedModel) ? config.selectedModel : result.models[0] ?? config.selectedModel,
  });
}

function getBridgeState(): BridgeState {
  const config = loadConfig();
  bridgeServer.updateConfig(config);
  return {
    config,
    stats: bridgeServer.getStats(),
    logs: bridgeServer.getLogs(),
    clientKeys: loadClientKeys(),
  };
}

async function createWindow() {
  Menu.setApplicationMenu(null);
  app.setName("Sparkly API");

  const window = new BrowserWindow({
    width: 1400,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    title: "Sparkly API",
    icon: logoPath,
    backgroundColor: "#f2efe8",
    webPreferences: {
      preload: useLocalhostBridge ? undefined : path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
    autoHideMenuBar: true,
  });

  window.setMenuBarVisibility(false);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await window.loadURL(devServerUrl);
    return;
  }

  await window.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
}

app.whenReady().then(async () => {
  if (!useLocalhostBridge) {
    await bridgeServer.start(loadConfig());
  }

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  event.preventDefault();
  await bridgeServer.stop();
  app.exit();
});

ipcMain.handle("bridge:get-state", async () => {
  return getBridgeState();
});

ipcMain.handle("bridge:save-config", async (_event, config: SaveConfigInput) => {
  const saved = saveConfig(config);
  await bridgeServer.start(saved);
  return getBridgeState();
});

ipcMain.handle("bridge:restart-server", async () => {
  await bridgeServer.start(loadConfig());
  return getBridgeState();
});

ipcMain.handle("bridge:create-client-key", async (_event, input: CreateClientKeyInput) => {
  createClientKey(input.name);
  return getBridgeState();
});

ipcMain.handle("bridge:update-client-key", async (_event, input: UpdateClientKeyInput) => {
  updateClientKey(input.id, input.name);
  return getBridgeState();
});

ipcMain.handle("bridge:delete-client-key", async (_event, input: DeleteClientKeyInput) => {
  deleteClientKey(input.id);
  return getBridgeState();
});

ipcMain.handle("bridge:create-account", async (_event, input: CreateAccountInput) => {
  const saved = createAccount(input);
  await bridgeServer.start(saved);
  return getBridgeState();
});

ipcMain.handle("bridge:update-account", async (_event, input: UpdateAccountInput) => {
  const saved = updateAccount(input);
  await bridgeServer.start(saved);
  return getBridgeState();
});

ipcMain.handle("bridge:delete-account", async (_event, input: DeleteAccountInput) => {
  const saved = deleteAccount(input.id);
  await bridgeServer.start(saved);
  return getBridgeState();
});

ipcMain.handle("bridge:select-account", async (_event, input: SelectAccountInput) => {
  const saved = selectActiveAccount(input.id);
  await bridgeServer.start(saved);
  return getBridgeState();
});

ipcMain.handle("bridge:refresh-active-account-models", async () => {
  const saved = await syncActiveAccountModels(loadConfig());
  await bridgeServer.start(saved);
  return getBridgeState();
});

ipcMain.handle("bridge:open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("bridge:open-devtools", async () => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!window) {
    return;
  }

  window.webContents.openDevTools({ mode: "detach", activate: true });
});

ipcMain.handle("bridge:reset-usage", async (_event, input: ResetUsageInput) => {
  if (input.confirm) {
    bridgeServer.clearLogs();
    clearUsageLogs();
  }
  return getBridgeState();
});

ipcMain.handle("bridge:playground-load-models", async (_event, input: PlaygroundModelsInput): Promise<PlaygroundModelsResult> => {
  return loadModelsFromProvider(input);
});

ipcMain.handle("bridge:playground-test", async (_event, input: PlaygroundTestInput): Promise<PlaygroundTestResult> => {
  try {
    const normalizedBaseUrl = normalizeOpenAiBaseUrl(input.baseUrl);
    const response = await fetch(`${normalizedBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
          { role: "user", content: input.message },
        ],
        max_tokens: 300,
      }),
    });

    const text = await response.text();
    let raw: unknown = text;

    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = text;
    }

    const content = typeof raw === "object" && raw !== null
      ? String((raw as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "")
      : String(raw ?? "");
    const providerError = summarizePlaygroundFailure(response.status, raw, text);
    const displayContent = response.ok
      ? content
      : providerError;

    return {
      ok: response.ok,
      status: response.status,
      model: input.model,
      content: displayContent,
      raw,
      error: response.ok ? undefined : providerError || content || "Request failed",
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      model: input.model,
      content: "",
      raw: null,
      error: error instanceof Error ? error.message : "Unknown playground error",
    };
  }
});

