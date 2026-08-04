import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const cli = fileURLToPath(new URL("./sparkly-cli.mjs", import.meta.url));

async function runCli(args) {
  const child = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}/v1`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("models discovers router catalogs and normalizes a /v1 base", async () => {
  await withServer((request, response) => {
    if (request.url === "/api/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ models: [{ alias: "test-model", fullModel: "test/test-model", provider: "test" }] }));
      return;
    }
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: { message: "not found" } }));
  }, async (baseUrl) => {
    const result = await runCli(["models", "provider", "--provider-url", baseUrl, "--json", "--timeout", "1000"]);
    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.endpoint, "/api/models");
    assert.equal(body.models[0].id, "test/test-model");
    assert.equal(body.models[0].alias, "test-model");
  });
});

test("model discovery waits for the authoritative configured route before fallback", async () => {
  const visited = [];
  await withServer((request, response) => {
    visited.push(request.url);
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/models") {
      setTimeout(() => response.end(JSON.stringify({ data: [{ id: "configured/authoritative-model" }] })), 75);
      return;
    }
    if (request.url === "/api/models") {
      response.end(JSON.stringify({ models: [{ fullModel: "internal/wrong-model" }] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  }, async (baseUrl) => {
    const result = await runCli(["models", "provider", "--provider-url", baseUrl, "--json", "--timeout", "1000"]);
    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.endpoint, "/v1/models");
    assert.deepEqual(body.models.map((model) => model.id), ["configured/authoritative-model"]);
    assert.deepEqual(visited, ["/v1/models"]);
  });
});

test("models accepts top-level arrays and native name fields", async () => {
  await withServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/models") {
      response.end(JSON.stringify([{ id: "together/model" }, { name: "cohere-command" }]));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  }, async (baseUrl) => {
    const result = await runCli(["models", "provider", "--provider-url", baseUrl, "--json", "--timeout", "1000"]);
    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.deepEqual(body.models.map((model) => model.id), ["together/model", "cohere-command"]);
    assert.equal(body.detectedProtocol, "openai-compatible");
  });
});

test("request emits a nonzero exit for an HTTP failure", async () => {
  await withServer((_request, response) => {
    response.statusCode = 401;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: { message: "denied" } }));
  }, async (baseUrl) => {
    const result = await runCli(["request", "GET", "/stats", "--bridge-url", baseUrl, "--json"]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).status, 401);
  });
});

test("chat falls back to /api/v1 without producing /v1/v1", async () => {
  const visited = [];
  await withServer((request, response) => {
    visited.push(request.url);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/chat/completions") {
      response.end(JSON.stringify({ choices: [{ message: { content: "SPARKLY_OK" } }] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ detail: "Not Found" }));
  }, async (baseUrl) => {
    const result = await runCli(["chat", "hello", "--provider-url", baseUrl, "--model", "test-model", "--json", "--timeout", "1000"]);
    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.resolvedUrl.endsWith("/api/v1/chat/completions"), true);
    assert.equal(visited.includes("/v1/v1/chat/completions"), false);
  });
});

test("a model_not_found 404 is not replayed on alternate routes", async () => {
  const visited = [];
  await withServer((request, response) => {
    visited.push(request.url);
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: { code: "model_not_found", message: "No active credentials for provider" } }));
  }, async (baseUrl) => {
    const result = await runCli(["chat", "hello", "--provider-url", baseUrl, "--model", "missing", "--json", "--timeout", "1000"]);
    assert.equal(result.code, 1);
    assert.equal(visited.length, 1);
  });
});

test("offline state mutations are atomic and redact secrets", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "sparkly-cli-test-"));
  try {
    const added = await runCli(["accounts", "add", "--data-dir", dataDir, "--base-url", "http://localhost:20128/v1", "--upstream-key", "no_api_key", "--force", "--json"]);
    assert.equal(added.code, 0, added.stderr);
    assert.equal(JSON.parse(added.stdout).account.apiKey.includes("no_api_key"), false);

    const created = await runCli(["keys", "create", "--data-dir", dataDir, "--name", "Automation", "--force", "--json"]);
    assert.equal(created.code, 0, created.stderr);
    const visible = JSON.parse(created.stdout);

    const config = JSON.parse(await readFile(path.join(dataDir, "bridge-config.json"), "utf8"));
    const keys = JSON.parse(await readFile(path.join(dataDir, "client-keys.json"), "utf8"));
    assert.notEqual(visible.key.key, keys[0].key);
    const revealed = await runCli(["keys", "list", "--data-dir", dataDir, "--reveal-secrets", "--json"]);
    assert.equal(revealed.code, 0, revealed.stderr);
    assert.equal(JSON.parse(revealed.stdout).keys[0].key, keys[0].key);
    assert.equal(config.localPort, 48231);
    assert.equal(config.accounts[0].baseUrl, "http://localhost:20128/v1");
    assert.equal(keys[0].key.startsWith("sk-"), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("unknown commands are usage errors", async () => {
  const result = await runCli(["unknown-command", "--json"]);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stderr).error.code, "INVALID_ARGUMENT");
});
