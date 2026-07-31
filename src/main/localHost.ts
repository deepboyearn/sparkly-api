import express from "express";
import cors from "cors";
import { spawn, type ChildProcess } from "node:child_process";
import { BridgeServer } from "./bridgeServer";
import { clearUsageLogs, createAccount, createClientKey, deleteAccount, deleteClientKey, loadClientKeys, loadConfig, saveConfig, selectActiveAccount, updateAccount, updateClientKey } from "./configStore";
import { V0_MODELS } from "../shared/types";
import type { BridgeConfig, BridgeState, PlaygroundModelsInput, PlaygroundModelsResult, PlaygroundTestInput, PlaygroundTestResult, ResetUsageInput } from "../shared/types";

const controlPort = Number(process.env.BRIDGE_CONTROL_PORT ?? 48232);
const devAppUrl = process.env.SPARKLY_DEV_APP_URL ?? "http://127.0.0.1:5173";
process.env.SPARKLY_DEV_APP_URL = devAppUrl;
process.env.SPARKLY_CONTROL_URL = `http://127.0.0.1:${controlPort}`;

const bridgeServer = new BridgeServer();
let electronProcess: ChildProcess | null = null;

function normalizeOpenAiBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
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

async function playgroundTest(input: PlaygroundTestInput): Promise<PlaygroundTestResult> {
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

    return {
      ok: response.ok,
      status: response.status,
      model: input.model,
      content: response.ok ? content : providerError,
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
}

function openElectronWindow() {
  if (electronProcess && !electronProcess.killed) {
    return { ok: true, alreadyOpen: true };
  }

  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm", "run", "electron:localhost"]
    : ["run", "electron:localhost"];

  electronProcess = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
      SPARKLY_USE_LOCALHOST_BRIDGE: "1",
    },
    stdio: "ignore",
    windowsHide: true,
  });

  electronProcess.once("exit", () => {
    electronProcess = null;
  });
  electronProcess.once("error", () => {
    electronProcess = null;
  });

  return { ok: true, alreadyOpen: false };
}

function openUrl(url: string) {
  if (process.platform === "win32") {
    spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    }).unref();
    return;
  }

  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], {
    stdio: "ignore",
    detached: true,
  }).unref();
}

async function waitForDevApp() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(devAppUrl, { method: "HEAD" });
      if (response.ok) {
        return true;
      }
    } catch {
      // Vite is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

async function openBridgeBaseUrlWhenReady() {
  if (process.env.SPARKLY_AUTO_OPEN_BROWSER === "0") {
    return;
  }

  await waitForDevApp();
  openUrl(bridgeServer.getStats().localBaseUrl);
}

async function startControlServer() {
  await bridgeServer.start(loadConfig());

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/state", (_req, res) => res.json(getBridgeState()));
  app.post("/api/config", async (req, res) => {
    const saved = saveConfig(req.body as BridgeConfig);
    await bridgeServer.start(saved);
    res.json(getBridgeState());
  });
  app.post("/api/restart", async (_req, res) => {
    await bridgeServer.start(loadConfig());
    res.json(getBridgeState());
  });
  app.post("/api/client-keys", (req, res) => {
    createClientKey(String(req.body?.name ?? ""));
    res.json(getBridgeState());
  });
  app.put("/api/client-keys/:id", (req, res) => {
    updateClientKey(req.params.id, String(req.body?.name ?? ""));
    res.json(getBridgeState());
  });
  app.delete("/api/client-keys/:id", (req, res) => {
    deleteClientKey(req.params.id);
    res.json(getBridgeState());
  });
  app.post("/api/accounts", async (req, res) => {
    const saved = createAccount(req.body);
    await bridgeServer.start(saved);
    res.json(getBridgeState());
  });
  app.put("/api/accounts/:id", async (req, res) => {
    const saved = updateAccount({ ...req.body, id: req.params.id });
    await bridgeServer.start(saved);
    res.json(getBridgeState());
  });
  app.delete("/api/accounts/:id", async (req, res) => {
    const saved = deleteAccount(req.params.id);
    await bridgeServer.start(saved);
    res.json(getBridgeState());
  });
  app.post("/api/accounts/:id/select", async (req, res) => {
    const saved = selectActiveAccount(req.params.id);
    await bridgeServer.start(saved);
    res.json(getBridgeState());
  });
  app.post("/api/accounts/refresh-models", async (_req, res) => {
    const saved = await syncActiveAccountModels(loadConfig());
    await bridgeServer.start(saved);
    res.json(getBridgeState());
  });
  app.post("/api/usage/reset", (req, res) => {
    if ((req.body as ResetUsageInput)?.confirm) {
      bridgeServer.clearLogs();
      clearUsageLogs();
    }
    res.json(getBridgeState());
  });
  app.post("/api/playground/models", async (req, res) => res.json(await loadModelsFromProvider(req.body)));
  app.post("/api/playground/test", async (req, res) => res.json(await playgroundTest(req.body)));
  app.post("/api/electron/open", (_req, res) => {
    try {
      res.json(openElectronWindow());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open desktop window";
      res.status(500).json({ ok: false, error: message });
    }
  });
  app.post("/api/open-external", (_req, res) => res.status(204).end());
  app.post("/api/open-devtools", (_req, res) => res.status(204).end());

  app.listen(controlPort, "127.0.0.1", () => {
    console.log(`Sparkly API app: ${bridgeServer.getStats().localBaseUrl}`);
    console.log(`Sparkly API OpenAI bridge: ${bridgeServer.getStats().localBaseUrl}/v1`);
    void openBridgeBaseUrlWhenReady();
  });
}

startControlServer().catch((error) => {
  console.error(error);
  process.exit(1);
});