#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  addAccount,
  createClientKey,
  defaultDataDir,
  loadState,
  mutateState,
  redactState,
  removeAccount,
  removeClientKey,
  selectAccount,
  setClientKeyActive,
  setConfig,
} from "./sparkly-state.mjs";

const VERSION = "1.2.0";
const DEFAULT_BRIDGE_URL = "http://localhost:48231";
const DEFAULT_PROVIDER_URL = "http://localhost:20128/v1";
const DEFAULT_API_KEY = "no_api_key";
const DEFAULT_TIMEOUT_MS = 30_000;
const AUTHORITATIVE_DISCOVERY_TIMEOUT_MS = 20_000;
const FALLBACK_DISCOVERY_TIMEOUT_MS = 8_000;

class CliError extends Error {
  constructor(message, code = "CLI_ERROR", exitCode = 1, details) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    if (equals > 2) {
      options[token.slice(2, equals)] = token.slice(equals + 1);
      continue;
    }
    const key = token.slice(2);
    if (["json", "stream", "strict", "help", "version", "include-raw", "reveal-secrets", "force"].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`Missing value for --${key}.`, "INVALID_ARGUMENT", 2);
    }
    options[key] = value;
    index += 1;
  }
  return { command: positional.shift() ?? "help", positional, options };
}

function normalizeRoot(value) {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  return trimmed.replace(/\/v1$/i, "");
}

function endpoint(baseUrl, path) {
  return `${normalizeRoot(baseUrl)}${path}`;
}

const routeCache = new Map();

function routeCandidates(baseUrl, path) {
  const supplied = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  const suffix = path.startsWith("/v1") ? path.slice(3) : path;
  const candidates = [];
  const push = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  if (/\/(?:api\/)?v1$/i.test(supplied)) push(`${supplied}${suffix}`);
  else push(`${supplied}${path}`);
  push(`${normalizeRoot(supplied)}${path}`);
  try {
    const origin = new URL(supplied).origin;
    push(`${origin}${path}`);
    push(`${origin}/api${path}`);
  } catch {
    // requestJson will produce the actionable invalid/reachability error.
  }
  return candidates;
}

function routeMissing(result) {
  if (result.status === 405) return true;
  if (result.status !== 404) return false;
  const code = result.body?.error?.code ?? "";
  if (["model_not_found", "authentication_error"].includes(code)) return false;
  const message = String(result.body?.error?.message ?? result.body?.detail ?? result.body ?? "").toLowerCase();
  return !message || /not found|cannot (?:get|post)|no route|<!doctype html/.test(message);
}

async function requestCompatible(baseUrl, path, request) {
  const key = `${String(baseUrl).replace(/\/+$/, "")}|${path}|${request.method ?? "GET"}`;
  const cached = routeCache.get(key);
  const candidates = routeCandidates(baseUrl, path);
  if (cached) {
    const index = candidates.indexOf(cached);
    if (index >= 0) candidates.splice(index, 1);
    candidates.unshift(cached);
  }
  const attempts = [];
  for (const url of candidates) {
    try {
      const result = await requestJson(url, request);
      attempts.push({ url, status: result.status, durationMs: result.durationMs });
      if (routeMissing(result)) {
        routeCache.delete(key);
        continue;
      }
      routeCache.set(key, url);
      return { ...result, resolvedUrl: url, routeAttempts: attempts };
    } catch (error) {
      attempts.push({ url, error: serializeError(error) });
      if (error?.code === "NETWORK_ERROR") continue;
      throw error;
    }
  }
  return { ok: false, status: 404, body: { error: { type: "route_not_found", message: "No compatible endpoint route was found." } }, routeAttempts: attempts };
}

function integerOption(value, name, fallback, minimum = 1, maximum = 300_000) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new CliError(
      `--${name} must be an integer between ${minimum} and ${maximum}.`,
      "INVALID_ARGUMENT",
      2,
    );
  }
  return number;
}

function configFrom(options) {
  return {
    bridgeUrl: options["bridge-url"] ?? process.env.SPARKLY_BRIDGE_URL ?? DEFAULT_BRIDGE_URL,
    providerUrl: options["provider-url"] ?? process.env.SPARKLY_PROVIDER_URL ?? DEFAULT_PROVIDER_URL,
    apiKey: options["api-key"] ?? process.env.SPARKLY_API_KEY ?? DEFAULT_API_KEY,
    model: options.model ?? process.env.SPARKLY_MODEL ?? "",
    protocol: options.protocol ?? process.env.SPARKLY_PROTOCOL ?? "auto",
    timeoutMs: integerOption(options.timeout, "timeout", DEFAULT_TIMEOUT_MS),
    json: Boolean(options.json),
    strict: Boolean(options.strict),
    includeRaw: Boolean(options["include-raw"]),
    revealSecrets: Boolean(options["reveal-secrets"]),
    force: Boolean(options.force),
    dataDir: options["data-dir"] ?? process.env.SPARKLY_DATA_DIR ?? defaultDataDir(),
  };
}

function redact(value, depth = 0) {
  if (depth > 8) return "[depth-limit]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /^(?:key|authorization|api[-_]?key|token|secret|password)$/i.test(key)
      ? "[REDACTED]"
      : redact(item, depth + 1);
  }
  return result;
}

async function fetchBounded(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new CliError(`Request timed out after ${timeoutMs} ms: ${url}`, "TIMEOUT", 4);
    }
    throw new CliError(`Could not reach ${url}: ${error.message}`, "NETWORK_ERROR", 4);
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse(response, includeRaw = false) {
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return includeRaw ? { body, raw: text } : { body };
}

function authHeaders(apiKey, extra = {}) {
  return {
    authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
    ...extra,
  };
}

async function requestJson(url, { apiKey, method = "GET", body, timeoutMs, headers = {}, includeRaw }) {
  const { response, durationMs } = await fetchBounded(
    url,
    {
      method,
      headers: authHeaders(apiKey, {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs,
  );
  const payload = await readResponse(response, includeRaw);
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    durationMs,
    ...payload,
  };
}

function extractModels(body) {
  const items = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const seen = new Set();
  const models = [];
  for (const item of items) {
    // Prefer the exact provider-qualified request ID. Aliases are useful for
    // display, but can collide across providers and may not be routable.
    const id = typeof item === "string" ? item : item?.id ?? item?.fullModel ?? item?.name ?? item?.model ?? item?.alias;
    if (typeof id === "string" && id.trim() && !seen.has(id.trim())) {
      seen.add(id.trim());
      models.push({
        id: id.trim(),
        provider: item?.provider ?? item?.owned_by ?? null,
        name: item?.name ?? null,
        alias: item?.alias ?? null,
        fullModel: item?.fullModel ?? null,
        capabilities: item?.caps ?? null,
      });
    }
  }
  return models;
}

function modelDiscoveryCandidates(baseUrl, requestedProtocol = "auto") {
  const supplied = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  const protocols = requestedProtocol === "auto"
    ? ["openai-compatible", "anthropic", "gemini", "ollama", "cohere"]
    : [requestedProtocol];
  const candidates = [];
  const push = (protocol, url, headers = {}) => {
    if (url && !candidates.some((candidate) => candidate.protocol === protocol && candidate.url === url)) {
      candidates.push({ protocol, url, headers });
    }
  };
  for (const protocol of protocols) {
    if (protocol === "openai-compatible") {
      for (const url of routeCandidates(supplied, "/v1/models")) push(protocol, url);
      try { push(protocol, `${new URL(normalizeRoot(supplied)).origin}/api/models`); } catch { /* reported by request */ }
    } else if (protocol === "anthropic") {
      for (const url of routeCandidates(supplied, "/v1/models")) push(protocol, url, { "anthropic-version": "2023-06-01" });
    } else if (protocol === "gemini") {
      push(protocol, `${supplied.replace(/\/v1beta$/i, "")}/v1beta/models`, { "x-goog-api-key": configPlaceholderApiKey });
    } else if (protocol === "ollama") {
      push(protocol, `${supplied.replace(/\/api$/i, "")}/api/tags`);
    } else if (protocol === "cohere") {
      push(protocol, routeCandidates(supplied, "/v1/models")[0]);
    }
  }
  return candidates;
}

const configPlaceholderApiKey = "__SPARKLY_API_KEY__";

async function discoverModels(config, baseUrl = config.providerUrl) {
  const candidates = modelDiscoveryCandidates(baseUrl, config.protocol);
  const attempts = [];
  let winner = null;

  // Catalog probes are read-only and sequential. Generation commands remain
  // protocol-specific and are never replayed merely because another API exists.
  for (const [index, candidate] of candidates.entries()) {
    try {
      const headers = Object.fromEntries(Object.entries(candidate.headers).map(([key, value]) => [key, value === configPlaceholderApiKey ? config.apiKey : value]));
      const result = await requestJson(candidate.url, {
        apiKey: config.apiKey,
        headers,
        timeoutMs: Math.min(config.timeoutMs, index === 0 ? AUTHORITATIVE_DISCOVERY_TIMEOUT_MS : FALLBACK_DISCOVERY_TIMEOUT_MS),
        includeRaw: config.includeRaw,
      });
      const attempt = { protocol: candidate.protocol, path: new URL(candidate.url).pathname, url: candidate.url, ...result, models: extractModels(result.body) };
      attempts.push(attempt);
      if (attempt.ok && attempt.models.length > 0) {
        winner = attempt;
        break;
      }
    } catch (error) {
      attempts.push({ protocol: candidate.protocol, path: new URL(candidate.url).pathname, url: candidate.url, ok: false, error: serializeError(error), models: [] });
    }
  }
  return { ok: Boolean(winner), winner, attempts };
}

function selectModel(discovery, requested) {
  if (requested) return requested;
  const models = discovery?.winner?.models ?? [];
  const preferred = [
    "gpt-5.4-mini",
    "gpt-5.4",
    "qwen3.5-plus",
    "glm-4.7",
    "claude-sonnet-4-6",
  ];
  for (const candidate of preferred) {
    const exact = models.find((model) => model.id === candidate);
    if (exact) return exact.id;
  }
  const textModel = models.find((model) => !/image|audio|embedding|transcri/i.test(model.id));
  return textModel?.id ?? models[0]?.id ?? "";
}

function extractText(body) {
  const chat = body?.choices?.[0]?.message?.content;
  if (typeof chat === "string") return chat;
  if (Array.isArray(chat)) return chat.map((part) => part?.text ?? "").join("");
  if (typeof body?.output_text === "string") return body.output_text;
  if (Array.isArray(body?.content)) return body.content.map((part) => part?.text ?? "").join("");
  return "";
}

async function streamRequest(url, body, config, headers = {}) {
  const { response, durationMs } = await fetchBounded(
    url,
    {
      method: "POST",
      headers: authHeaders(config.apiKey, {
        accept: "text/event-stream",
        "content-type": "application/json",
        ...headers,
      }),
      body: JSON.stringify({ ...body, stream: true }),
    },
    config.timeoutMs,
  );
  if (!response.ok || !response.body) {
    return { ok: false, status: response.status, durationMs, ...(await readResponse(response, config.includeRaw)) };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let events = 0;
  let done = false;
  let text = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        events += 1;
        if (data === "[DONE]") {
          done = true;
          continue;
        }
        try {
          const event = JSON.parse(data);
          text += event?.choices?.[0]?.delta?.content ?? event?.delta?.text ?? event?.text ?? "";
          if (/\.done$|message_stop|response\.completed/.test(event?.type ?? "")) done = true;
        } catch {
          // A diagnostic should report malformed SSE without crashing mid-stream.
        }
      }
    }
  }
  return {
    ok: response.ok && events > 0,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    durationMs,
    events,
    done,
    text,
  };
}

function serializeError(error) {
  return {
    code: error?.code ?? "UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message : String(error),
    details: error?.details,
  };
}

function check(name, status, details = {}) {
  const { status: httpStatus, ...rest } = details;
  return { name, status, ...(httpStatus === undefined ? {} : { httpStatus }), ...rest };
}

async function runDoctor(config, target = "all") {
  const checks = [];
  let discovery = null;
  let model = config.model;

  if (target === "all" || target === "provider") {
    const rootHealth = await safeJson(`${normalizeRoot(config.providerUrl)}/api/health`, config);
    checks.push(check("provider.health", rootHealth.ok ? "pass" : "fail", rootHealth));

    discovery = await discoverModels(config);
    checks.push(
      check(discovery.ok ? "provider.models" : "provider.models", discovery.ok ? "pass" : "fail", {
        endpoint: discovery.winner?.path,
        count: discovery.winner?.models?.length ?? 0,
        attempts: discovery.attempts.map(({ path, ok, status, durationMs, error, models }) => ({
          path,
          ok,
          status,
          durationMs,
          error,
          modelCount: models.length,
        })),
      }),
    );
    model = selectModel(discovery, model);

    if (!model) {
      checks.push(check("provider.chat", "skip", { reason: "No model could be discovered or selected." }));
      checks.push(check("provider.chat.stream", "skip", { reason: "No model could be discovered or selected." }));
      checks.push(check("provider.responses", "skip", { reason: "No model could be discovered or selected." }));
      checks.push(check("provider.anthropic", "skip", { reason: "No model could be discovered or selected." }));
    } else {
      const chat = await safeCompatible(config.providerUrl, "/v1/chat/completions", config, {
        method: "POST",
        body: { model, messages: [{ role: "user", content: "Reply exactly SPARKLY_OK" }], max_tokens: 32 },
      });
      checks.push(check("provider.chat", chat.ok && Boolean(extractText(chat.body)) ? "pass" : "fail", { model, ...chat }));

      const stream = await safeStream(config.providerUrl, "/v1/chat/completions", {
        model,
        messages: [{ role: "user", content: "Reply exactly SPARKLY_STREAM_OK" }],
        max_tokens: 32,
      }, config);
      checks.push(check("provider.chat.stream", stream.ok ? "pass" : "fail", { model, ...stream }));

      const responses = await safeCompatible(config.providerUrl, "/v1/responses", config, {
        method: "POST",
        body: { model, input: "Reply exactly SPARKLY_RESPONSES_OK", max_output_tokens: 32 },
      });
      checks.push(check("provider.responses", responses.ok && Boolean(extractText(responses.body)) ? "pass" : "fail", { model, ...responses }));

      const anthropic = await safeCompatible(config.providerUrl, "/v1/messages", config, {
        method: "POST",
        headers: { "anthropic-version": "2023-06-01" },
        body: { model, max_tokens: 32, messages: [{ role: "user", content: "Reply exactly SPARKLY_ANTHROPIC_OK" }] },
      });
      checks.push(check("provider.anthropic", anthropic.ok && Boolean(extractText(anthropic.body)) ? "pass" : "fail", { model, ...anthropic }));
    }
  }

  if (target === "all" || target === "bridge") {
    const health = await safeJson(endpoint(config.bridgeUrl, "/health"), config);
    checks.push(check("bridge.health", health.ok && health.body?.ok === true ? "pass" : "fail", health));

    const unauthenticated = await safeJson(endpoint(config.bridgeUrl, "/v1/models"), { ...config, apiKey: "sparkly-intentionally-invalid" });
    checks.push(check("bridge.auth.rejects-invalid", unauthenticated.status === 401 ? "pass" : "fail", unauthenticated));

    const models = await safeJson(endpoint(config.bridgeUrl, "/v1/models"), config);
    checks.push(check("bridge.models", models.ok && extractModels(models.body).length > 0 ? "pass" : "fail", {
      ...models,
      modelCount: extractModels(models.body).length,
    }));
    const bridgeModel = config.model || extractModels(models.body)[0]?.id || model;

    const malformed = await safeMalformed(endpoint(config.bridgeUrl, "/v1/chat/completions"), config);
    checks.push(check("bridge.malformed-json", malformed.status === 400 && Boolean(malformed.body?.error?.message) ? "pass" : "fail", malformed));

    if (!bridgeModel) {
      for (const name of ["bridge.chat", "bridge.chat.stream", "bridge.responses", "bridge.anthropic"]) {
        checks.push(check(name, "skip", { reason: "No bridge model is available." }));
      }
    } else {
      const chat = await safeJson(endpoint(config.bridgeUrl, "/v1/chat/completions"), config, {
        method: "POST",
        body: { model: bridgeModel, messages: [{ role: "user", content: "Reply exactly SPARKLY_BRIDGE_OK" }], max_tokens: 32 },
      });
      checks.push(check("bridge.chat", chat.ok && Boolean(extractText(chat.body)) ? "pass" : "fail", { model: bridgeModel, ...chat }));

      const stream = await safeStream(config.bridgeUrl, "/v1/chat/completions", {
        model: bridgeModel,
        messages: [{ role: "user", content: "Reply exactly SPARKLY_BRIDGE_STREAM_OK" }],
        max_tokens: 32,
      }, config);
      checks.push(check("bridge.chat.stream", stream.ok ? "pass" : "fail", { model: bridgeModel, ...stream }));

      const responses = await safeJson(endpoint(config.bridgeUrl, "/v1/responses"), config, {
        method: "POST",
        body: { model: bridgeModel, input: "Reply exactly SPARKLY_BRIDGE_RESPONSES_OK", max_output_tokens: 32 },
      });
      checks.push(check("bridge.responses", responses.ok && Boolean(extractText(responses.body)) ? "pass" : "fail", { model: bridgeModel, ...responses }));

      const anthropic = await safeJson(endpoint(config.bridgeUrl, "/v1/messages"), config, {
        method: "POST",
        headers: { "anthropic-version": "2023-06-01" },
        body: { model: bridgeModel, max_tokens: 32, messages: [{ role: "user", content: "Reply exactly SPARKLY_BRIDGE_ANTHROPIC_OK" }] },
      });
      checks.push(check("bridge.anthropic", anthropic.ok && Boolean(extractText(anthropic.body)) ? "pass" : "fail", { model: bridgeModel, ...anthropic }));
    }

    const [stats, logs] = await Promise.all([
      safeJson(endpoint(config.bridgeUrl, "/stats"), config),
      safeJson(endpoint(config.bridgeUrl, "/logs"), config),
    ]);
    checks.push(check("bridge.stats", stats.ok && typeof stats.body?.totalRequests === "number" ? "pass" : "fail", stats));
    checks.push(check("bridge.logs", logs.ok && Array.isArray(logs.body?.data) ? "pass" : "fail", logs));
  }

  const summary = checks.reduce(
    (result, item) => ({ ...result, [item.status]: (result[item.status] ?? 0) + 1 }),
    { pass: 0, fail: 0, skip: 0 },
  );
  return {
    ok: summary.fail === 0 && (!config.strict || summary.skip === 0),
    target,
    bridgeUrl: normalizeRoot(config.bridgeUrl),
    providerUrl: normalizeRoot(config.providerUrl),
    model: model || null,
    summary,
    checks,
  };
}

async function safeCompatible(baseUrl, path, config, overrides = {}) {
  try {
    return await requestCompatible(baseUrl, path, {
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      includeRaw: config.includeRaw,
      ...overrides,
    });
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

async function safeJson(url, config, overrides = {}) {
  try {
    return await requestJson(url, {
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      includeRaw: config.includeRaw,
      ...overrides,
    });
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

async function safeMalformed(url, config) {
  try {
    const { response, durationMs } = await fetchBounded(url, {
      method: "POST",
      headers: authHeaders(config.apiKey, { "content-type": "application/json" }),
      body: "{not-json",
    }, config.timeoutMs);
    return { status: response.status, durationMs, ...(await readResponse(response, config.includeRaw)) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

async function streamCompatible(baseUrl, path, body, config, headers = {}) {
  const attempts = [];
  for (const url of routeCandidates(baseUrl, path)) {
    try {
      const result = await streamRequest(url, body, config, headers);
      attempts.push({ url, status: result.status, durationMs: result.durationMs });
      if (routeMissing(result)) continue;
      return { ...result, resolvedUrl: url, routeAttempts: attempts };
    } catch (error) {
      attempts.push({ url, error: serializeError(error) });
      if (error?.code === "NETWORK_ERROR") continue;
      return { ok: false, error: serializeError(error), routeAttempts: attempts };
    }
  }
  return { ok: false, status: 404, routeAttempts: attempts, body: { error: { message: "No compatible streaming route was found." } } };
}

async function safeStream(baseUrl, path, body, config, headers) {
  return streamCompatible(baseUrl, path, body, config, headers);
}

async function bridgeIsRunning(config) {
  const result = await safeJson(endpoint(config.bridgeUrl, "/health"), { ...config, timeoutMs: Math.min(config.timeoutMs, 1_000) });
  return result.ok && result.body?.ok === true;
}

async function mutateOffline(config, mutation) {
  if (!config.force && await bridgeIsRunning(config)) {
    throw new CliError(
      "Sparkly is running and owns in-memory state. Stop it before persisted mutations, or pass --force and restart Sparkly immediately afterward.",
      "APP_RUNNING",
      1,
    );
  }
  return mutateState(config.dataDir, mutation);
}

async function loadBody(options) {
  if (options.body) {
    try {
      return JSON.parse(options.body);
    } catch (error) {
      throw new CliError(`--body is not valid JSON: ${error.message}`, "INVALID_JSON", 2);
    }
  }
  if (options.file) {
    try {
      return JSON.parse(await readFile(options.file, "utf8"));
    } catch (error) {
      throw new CliError(`Could not load JSON from ${options.file}: ${error.message}`, "INVALID_JSON", 2);
    }
  }
  return undefined;
}

function printHuman(result, revealSecrets = false) {
  if (Array.isArray(result?.checks)) {
    for (const item of result.checks) {
      const marker = item.status === "pass" ? "PASS" : item.status === "skip" ? "SKIP" : "FAIL";
      const latency = Number.isFinite(item.durationMs) ? ` (${item.durationMs} ms)` : "";
      console.log(`${marker.padEnd(4)} ${item.name}${latency}`);
      if (item.status === "fail") {
        const message = item.error?.message ?? item.body?.error?.message ?? item.body?.error ?? item.reason;
        if (message) console.log(`     ${message}`);
      }
    }
    console.log(`\n${result.ok ? "OK" : "FAILED"}: ${result.summary.pass} passed, ${result.summary.fail} failed, ${result.summary.skip} skipped`);
    if (result.model) console.log(`Model: ${result.model}`);
    return;
  }
  if (Array.isArray(result?.models)) {
    const visible = result.models.slice(0, 50);
    for (const model of visible) {
      const label = model.alias || model.name || model.id.split("/").pop() || model.id;
      console.log(`${label}\t${model.id}${model.provider ? `\t${model.provider}` : ""}`);
    }
    if (result.models.length > visible.length) {
      console.log(`... ${result.models.length - visible.length} more (use --json for the complete catalog)`);
    }
    console.log(`\n${result.models.length} model(s) from ${result.endpoint}`);
    return;
  }
  if (typeof result?.text === "string" && result.text) {
    console.log(result.text);
    return;
  }
  console.log(JSON.stringify(revealSecrets ? result : redact(result), null, 2));
}

function output(result, json, revealSecrets = false) {
  const safeResult = revealSecrets ? result : redact(result);
  if (json) console.log(JSON.stringify(safeResult, null, 2));
  else printHuman(safeResult, revealSecrets);
}

function help() {
  return `Sparkly CLI ${VERSION}\n\nUnity-style automation principles: one explicit batch command, no prompts, bounded execution, deterministic exit codes, and structured logs.\n\nUsage:\n  sparkly <command> [options]\n\nCommands:\n  doctor [all|provider|bridge]  Run conformance and integration diagnostics\n  models [provider|bridge]      Discover available models\n  chat <message>                Send an OpenAI chat completion\n  responses <input>             Send an OpenAI Responses request\n  anthropic <message>           Send an Anthropic Messages request\n  request <METHOD> <PATH>       Send an arbitrary bounded API request\n  app status                    Show runtime and persisted app status\n  config show|set               Read or mutate safe persisted settings\n  accounts list|add|select|rm   Manage persisted upstream accounts offline\n  keys list|create|enable|disable|rm\n                                Manage persisted Sparkly client keys offline\n  health                        Read Sparkly bridge health\n  stats                         Read authenticated bridge statistics\n  logs                          Read authenticated bridge logs\n  help                          Show this help\n\nOptions:\n  --bridge-url <url>    Sparkly bridge URL (default: ${DEFAULT_BRIDGE_URL})\n  --provider-url <url>  Upstream provider URL (default: ${DEFAULT_PROVIDER_URL})\n  --api-key <key>       API key (default: SPARKLY_API_KEY or no_api_key)\n  --model <id>          Explicit model; otherwise discover one\n  --timeout <ms>        Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})\n  --stream              Use SSE for chat\n  --json                Emit one machine-readable JSON document\n  --strict              Doctor treats skipped capabilities as failure\n  --body <json>         JSON body for request\n  --file <path>         Load request JSON body from a file\n  --include-raw         Include raw response text in JSON output\n  --data-dir <path>     Override Sparkly's application data directory\n  --reveal-secrets      Explicitly reveal persisted keys in output\n  --force               Allow offline mutation while Sparkly appears active\n\nExit codes:\n  0 success, 1 failed check/request, 2 usage error, 4 network/timeout error\n`;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.options.version || parsed.command === "version") {
    console.log(VERSION);
    return;
  }
  if (parsed.options.help || parsed.command === "help") {
    console.log(help());
    return;
  }
  const config = configFrom(parsed.options);
  let result;

  switch (parsed.command) {
    case "doctor": {
      const target = parsed.positional[0] ?? "all";
      if (!["all", "provider", "bridge"].includes(target)) throw new CliError("doctor target must be all, provider, or bridge.", "INVALID_ARGUMENT", 2);
      result = await runDoctor(config, target);
      break;
    }
    case "models": {
      const target = parsed.positional[0] ?? "provider";
      if (target === "provider") {
        const discovery = await discoverModels(config);
        result = {
          ok: discovery.ok,
          endpoint: discovery.winner?.path ?? null,
          models: discovery.winner?.models ?? [],
          detectedProtocol: discovery.winner?.protocol ?? null,
          attempts: discovery.attempts.map(({ protocol, path, ok, status, durationMs, error, models }) => ({ protocol, path, ok, status, durationMs, error, modelCount: models.length })),
        };
      } else if (target === "bridge") {
        const response = await requestJson(endpoint(config.bridgeUrl, "/v1/models"), { apiKey: config.apiKey, timeoutMs: config.timeoutMs, includeRaw: config.includeRaw });
        result = { ...response, models: extractModels(response.body), endpoint: "/v1/models" };
      } else throw new CliError("models target must be provider or bridge.", "INVALID_ARGUMENT", 2);
      break;
    }
    case "chat": {
      const message = parsed.positional.join(" ").trim();
      if (!message) throw new CliError("chat requires a message.", "INVALID_ARGUMENT", 2);
      const target = parsed.options.target === "bridge" ? config.bridgeUrl : config.providerUrl;
      const discovery = config.model ? null : await discoverModels(config, target);
      const model = selectModel(discovery, config.model);
      if (!model) throw new CliError("No model is available; pass --model explicitly.", "MODEL_NOT_FOUND", 1);
      const body = { model, messages: [{ role: "user", content: message }], max_tokens: integerOption(parsed.options["max-tokens"], "max-tokens", 512, 1, 1_000_000) };
      result = parsed.options.stream
        ? await streamCompatible(target, "/v1/chat/completions", body, config)
        : await requestCompatible(target, "/v1/chat/completions", { apiKey: config.apiKey, method: "POST", body, timeoutMs: config.timeoutMs, includeRaw: config.includeRaw });
      result = { ...result, model, text: result.text || extractText(result.body) };
      break;
    }
    case "responses": {
      const input = parsed.positional.join(" ").trim();
      if (!input) throw new CliError("responses requires input text.", "INVALID_ARGUMENT", 2);
      const target = parsed.options.target === "bridge" ? config.bridgeUrl : config.providerUrl;
      const discovery = config.model ? null : await discoverModels(config, target);
      const model = selectModel(discovery, config.model);
      result = await requestCompatible(target, "/v1/responses", { apiKey: config.apiKey, method: "POST", body: { model, input, max_output_tokens: 512 }, timeoutMs: config.timeoutMs, includeRaw: config.includeRaw });
      result = { ...result, model, text: extractText(result.body) };
      break;
    }
    case "anthropic": {
      const message = parsed.positional.join(" ").trim();
      if (!message) throw new CliError("anthropic requires a message.", "INVALID_ARGUMENT", 2);
      const target = parsed.options.target === "provider" ? config.providerUrl : config.bridgeUrl;
      const discovery = config.model ? null : await discoverModels(config, target);
      const model = selectModel(discovery, config.model);
      result = await requestCompatible(target, "/v1/messages", { apiKey: config.apiKey, method: "POST", headers: { "anthropic-version": "2023-06-01" }, body: { model, max_tokens: 512, messages: [{ role: "user", content: message }] }, timeoutMs: config.timeoutMs, includeRaw: config.includeRaw });
      result = { ...result, model, text: extractText(result.body) };
      break;
    }
    case "app": {
      const action = parsed.positional[0] ?? "status";
      if (action !== "status") throw new CliError("app supports only status.", "INVALID_ARGUMENT", 2);
      const [persisted, health] = await Promise.all([loadState(config.dataDir), safeJson(endpoint(config.bridgeUrl, "/health"), config)]);
      result = { ok: true, running: health.ok && health.body?.ok === true, health, persisted: redactState(persisted, config.revealSecrets) };
      break;
    }
    case "config": {
      const action = parsed.positional[0] ?? "show";
      if (action === "show") {
        const state = await loadState(config.dataDir);
        result = { ok: true, dataDir: state.dataDir, config: redactState(state.config, config.revealSecrets) };
      } else if (action === "set") {
        const key = parsed.positional[1];
        const value = parsed.positional.slice(2).join(" ");
        if (!key || value === "") throw new CliError("config set requires KEY VALUE.", "INVALID_ARGUMENT", 2);
        const changed = await mutateOffline(config, (state) => setConfig(state, key, value));
        result = { ok: true, change: changed.result, reloadRequired: true, dataDir: changed.state.dataDir };
      } else throw new CliError("config action must be show or set.", "INVALID_ARGUMENT", 2);
      break;
    }
    case "accounts": {
      const action = parsed.positional[0] ?? "list";
      if (action === "list") {
        const state = await loadState(config.dataDir);
        result = { ok: true, accounts: redactState(state.config.accounts, config.revealSecrets), activeAccountId: state.config.activeAccountId, dataDir: state.dataDir };
      } else if (action === "add") {
        const baseUrl = parsed.options["base-url"];
        if (!baseUrl) throw new CliError("accounts add requires --base-url.", "INVALID_ARGUMENT", 2);
        const changed = await mutateOffline(config, (state) => addAccount(state, { name: parsed.options.name, provider: parsed.options.provider, baseUrl, apiKey: parsed.options["upstream-key"] ?? config.apiKey }));
        result = { ok: true, account: redactState(changed.result, config.revealSecrets), reloadRequired: true };
      } else if (action === "select") {
        const id = parsed.positional[1];
        if (!id) throw new CliError("accounts select requires ID.", "INVALID_ARGUMENT", 2);
        const changed = await mutateOffline(config, (state) => selectAccount(state, id));
        result = { ok: true, account: redactState(changed.result, config.revealSecrets), reloadRequired: true };
      } else if (["rm", "remove", "delete"].includes(action)) {
        const id = parsed.positional[1];
        if (!id) throw new CliError("accounts rm requires ID.", "INVALID_ARGUMENT", 2);
        const changed = await mutateOffline(config, (state) => removeAccount(state, id));
        result = { ok: true, ...changed.result, reloadRequired: true };
      } else throw new CliError("accounts action must be list, add, select, or rm.", "INVALID_ARGUMENT", 2);
      break;
    }
    case "keys": {
      const action = parsed.positional[0] ?? "list";
      if (action === "list") {
        const state = await loadState(config.dataDir);
        result = { ok: true, keys: redactState(state.clientKeys, config.revealSecrets), dataDir: state.dataDir };
      } else if (action === "create") {
        const changed = await mutateOffline(config, (state) => createClientKey(state, parsed.options.name));
        result = { ok: true, key: redactState(changed.result, config.revealSecrets), reloadRequired: true };
      } else if (["enable", "disable"].includes(action)) {
        const id = parsed.positional[1];
        if (!id) throw new CliError(`keys ${action} requires ID.`, "INVALID_ARGUMENT", 2);
        const changed = await mutateOffline(config, (state) => setClientKeyActive(state, id, action === "enable"));
        result = { ok: true, key: redactState(changed.result, config.revealSecrets), reloadRequired: true };
      } else if (["rm", "remove", "delete"].includes(action)) {
        const id = parsed.positional[1];
        if (!id) throw new CliError("keys rm requires ID.", "INVALID_ARGUMENT", 2);
        const changed = await mutateOffline(config, (state) => removeClientKey(state, id));
        result = { ok: true, ...changed.result, reloadRequired: true };
      } else throw new CliError("keys action must be list, create, enable, disable, or rm.", "INVALID_ARGUMENT", 2);
      break;
    }
    case "request": {
      const method = (parsed.positional[0] ?? "").toUpperCase();
      const path = parsed.positional[1] ?? "";
      if (!method || !path.startsWith("/")) throw new CliError("request requires METHOD and an absolute /path.", "INVALID_ARGUMENT", 2);
      const target = parsed.options.target === "provider" ? config.providerUrl : config.bridgeUrl;
      result = await requestJson(endpoint(target, path), { apiKey: config.apiKey, method, body: await loadBody(parsed.options), timeoutMs: config.timeoutMs, includeRaw: config.includeRaw });
      break;
    }
    case "health":
      result = await requestJson(endpoint(config.bridgeUrl, "/health"), { apiKey: config.apiKey, timeoutMs: config.timeoutMs, includeRaw: config.includeRaw });
      break;
    case "stats":
      result = await requestJson(endpoint(config.bridgeUrl, "/stats"), { apiKey: config.apiKey, timeoutMs: config.timeoutMs, includeRaw: config.includeRaw });
      break;
    case "logs":
      result = await requestJson(endpoint(config.bridgeUrl, "/logs"), { apiKey: config.apiKey, timeoutMs: config.timeoutMs, includeRaw: config.includeRaw });
      break;
    default:
      throw new CliError(`Unknown command: ${parsed.command}.`, "INVALID_ARGUMENT", 2);
  }

  output(result, config.json, config.revealSecrets);
  if (result?.ok === false) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  const serialized = serializeError(error);
  const wantsJson = process.argv.includes("--json");
  if (wantsJson) console.error(JSON.stringify({ ok: false, error: serialized }, null, 2));
  else console.error(`sparkly: ${serialized.message}`);
  process.exitCode = error?.exitCode ?? 1;
}
