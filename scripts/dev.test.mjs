import assert from "node:assert/strict";
import net from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  allocateLoopbackPort,
  classifyWorkspaceProcess,
  recoverWorkspaceBackend,
  tauriConfigOverlay,
  windowsPortInspectionScript,
} from "./dev.mjs";

const root = "C:/work/sparkly";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sparklyOwner = (pid = 20) => ({
  pid,
  name: "sparkly-api.exe",
  executablePath: `${root}/src-tauri/target/debug/sparkly-api.exe`,
  commandLine: `${root}/src-tauri/target/debug/sparkly-api.exe`,
});

test("allocates an available ephemeral loopback port", async () => {
  const port = await allocateLoopbackPort();
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65_535);
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
});

test("builds a per-launch Tauri devUrl overlay", () => {
  assert.deepEqual(JSON.parse(tauriConfigOverlay("http://127.0.0.1:54321")), { build: { devUrl: "http://127.0.0.1:54321" } });
});

test("tracked config cannot silently attach to a normal dev server", async () => {
  const config = JSON.parse(await readFile(path.join(workspaceRoot, "src-tauri", "tauri.conf.json"), "utf8"));
  assert.equal(config.build.beforeDevCommand, undefined);
  assert.equal(config.build.devUrl, "http://127.0.0.1:9");
  const html = await readFile(path.join(workspaceRoot, "index.html"), "utf8");
  assert.match(html, /name="sparkly-runtime" content="sparkly-api:com\.sparklyapi\.sparklyapi:v1"/);
});

test("PowerShell inspection has no empty pipeline element", () => {
  const script = windowsPortInspectionScript(48231);
  assert.equal(script.includes("|;"), false);
  assert.throws(() => windowsPortInspectionScript(0), /invalid TCP port/);
});

test("classifies only the exact workspace backend", () => {
  assert.equal(classifyWorkspaceProcess(sparklyOwner(), root)?.kind, "sparkly");
  assert.equal(classifyWorkspaceProcess({ ...sparklyOwner(), executablePath: "C:/other/sparkly-api.exe" }, root), null);
  assert.equal(classifyWorkspaceProcess({ pid: 30, name: "postgres.exe", executablePath: "C:/postgres.exe", commandLine: "postgres" }, root), null);
});

test("recovers only a stale backend owned by this workspace", async () => {
  let available = false;
  const terminated = [];
  const result = await recoverWorkspaceBackend({
    workspaceRoot: root,
    isAvailable: async () => available,
    inspectOwner: async () => sparklyOwner(),
    terminate: async (pid) => { terminated.push(pid); available = true; },
    wait: async () => {},
    timeoutMs: 100,
  });
  assert.deepEqual(terminated, [20]);
  assert.equal(result.recovered, 20);
});

test("refuses a foreign process on the fixed client API port", async () => {
  await assert.rejects(
    recoverWorkspaceBackend({
      workspaceRoot: root,
      isAvailable: async () => false,
      inspectOwner: async () => ({ pid: 99, name: "other.exe", executablePath: "C:/other.exe", commandLine: "other" }),
    }),
    /will not be terminated/,
  );
});
