import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, open, readFile, unlink } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");
const lockPath = path.join(rootDir, ".sparkly-dev.lock");
const tauriCli = path.join(rootDir, "node_modules", "@tauri-apps", "cli", "tauri.js");
const viteCli = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const minimumFreeMemoryBytes = 2 * 1024 ** 3;
const backendPort = 48231;
const rendererMarker = "sparkly-api:com.sparklyapi.sparklyapi:v1";
const ownLock = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
const children = new Set();
let stopping = false;

function fail(message) {
  console.error(`\n[sparkly-dev] ${message}\n`);
  process.exitCode = 1;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function normalizedPath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

export function classifyWorkspaceProcess(owner, workspaceRoot = rootDir) {
  if (!owner || !Number.isSafeInteger(Number(owner.pid)) || Number(owner.pid) <= 0) return null;
  const root = normalizedPath(workspaceRoot);
  const executable = normalizedPath(owner.executablePath);
  const command = normalizedPath(owner.commandLine);
  const name = String(owner.name ?? "").toLowerCase();
  const ownsWorkspaceCommand = command.includes(`${root}/`);
  const isVite = name === "node.exe" && ownsWorkspaceCommand && command.includes("/node_modules/vite/bin/vite.js");
  const isNative = ["sparkly-api.exe", "sparkly_api.exe"].includes(name)
    && executable.startsWith(`${root}/src-tauri/target/`)
    && (executable.endsWith("/sparkly-api.exe") || executable.endsWith("/sparkly_api.exe"));
  if (isVite) return { kind: "vite", pid: Number(owner.pid), owner };
  if (isNative) return { kind: "sparkly", pid: Number(owner.pid), owner };
  return null;
}

function portIsAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") resolve(false);
      else reject(new Error(`could not verify localhost port ${port}: ${error.message}`));
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve(true)));
    });
  });
}

export function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate an ephemeral loopback port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export function windowsPortInspectionScript(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new TypeError(`invalid TCP port: ${port}`);
  return [
    `$listeners = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::1', '::') } | Select-Object -ExpandProperty OwningProcess -Unique)`,
    "if ($listeners.Count -eq 0) { exit 0 }",
    "if ($listeners.Count -ne 1) { Write-Error 'multiple listener owners'; exit 3 }",
    "$owner = Get-CimInstance Win32_Process -Filter \"ProcessId=$($listeners[0])\" -ErrorAction Stop",
    "[pscustomobject]@{ pid = [int]$owner.ProcessId; name = $owner.Name; executablePath = $owner.ExecutablePath; commandLine = $owner.CommandLine } | ConvertTo-Json -Compress",
  ].join("; ");
}

export async function inspectWindowsPortOwner(port) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsPortInspectionScript(port)], {
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    const text = stdout.trim();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`could not inspect the process using localhost:${port}: ${error.message}`, { cause: error });
  }
}

async function inspectPortOwner(port) {
  if (process.platform !== "win32") throw new Error(`localhost port ${port} is occupied; stop the existing process normally.`);
  return inspectWindowsPortOwner(port);
}

export async function recoverWorkspaceBackend({
  port = backendPort,
  workspaceRoot = rootDir,
  isAvailable = portIsAvailable,
  inspectOwner = inspectPortOwner,
  terminate = (pid) => process.kill(pid, "SIGTERM"),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 8_000,
} = {}) {
  if (await isAvailable(port)) return { recovered: null };
  const owner = await inspectOwner(port);
  const classification = classifyWorkspaceProcess(owner, workspaceRoot);
  if (classification?.kind !== "sparkly") {
    const identity = owner ? `PID ${owner.pid} (${owner.name || "unknown"})` : "an unverifiable process";
    throw new Error(`localhost port ${port} is owned by ${identity}, not this workspace's Sparkly backend. It will not be terminated.`);
  }
  console.log(`[sparkly-dev] Recovering stale Sparkly backend PID ${classification.pid}...`);
  await terminate(classification.pid);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAvailable(port)) return { recovered: classification.pid };
    await wait(150);
  }
  throw new Error(`stale Sparkly backend PID ${classification.pid} stopped, but localhost:${port} did not release.`);
}

async function removeOwnedLock() {
  try {
    if ((await readFile(lockPath, "utf8")) === ownLock) await unlink(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn(`[sparkly-dev] Could not remove launcher lock: ${error.message}`);
  }
}

async function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try { await handle.writeFile(ownLock, "utf8"); await handle.sync(); } finally { await handle.close(); }
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existing;
      try { existing = JSON.parse(await readFile(lockPath, "utf8")); }
      catch (parseError) { throw new Error("the development launcher lock exists but cannot be validated.", { cause: parseError }); }
      if (processIsAlive(existing?.pid)) throw new Error(`another Sparkly development launcher is already running (PID ${existing.pid}).`);
      try { await unlink(lockPath); } catch (unlinkError) { if (unlinkError?.code !== "ENOENT") throw unlinkError; }
    }
  }
  throw new Error("could not acquire the development launcher lock safely.");
}

function assertMemoryAvailable() {
  const freeBytes = os.freemem();
  if (freeBytes >= minimumFreeMemoryBytes || process.env.SPARKLY_ALLOW_LOW_MEMORY === "1") return;
  throw new Error(`only ${(freeBytes / 1024 ** 3).toFixed(1)} GiB of memory is available; at least 2.0 GiB is required.`);
}

function spawnOwned(command, args, options = {}) {
  const child = spawn(command, args, { cwd: rootDir, env: process.env, stdio: "inherit", windowsHide: false, detached: false, ...options });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function stopChildren(signal = "SIGTERM") {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill(signal); } catch (error) { console.warn(`[sparkly-dev] Could not stop PID ${child.pid}: ${error.message}`); }
    }
  }
}

async function waitForRenderer(url, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000), cache: "no-store" });
      const html = await response.text();
      if (response.ok && html.includes(`name="sparkly-runtime" content="${rendererMarker}"`)) return;
      lastError = "the responding server did not present Sparkly's renderer identity";
    } catch (error) { lastError = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Sparkly renderer failed its startup identity check: ${lastError}`);
}

export function tauriConfigOverlay(rendererUrl) {
  return JSON.stringify({ build: { devUrl: rendererUrl } });
}

async function forwardSignal(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n[sparkly-dev] ${signal} received; stopping owned children...`);
  await stopChildren(signal);
}

async function main() {
  await Promise.all([
    access(tauriCli, fsConstants.R_OK),
    access(viteCli, fsConstants.R_OK),
  ]).catch((error) => { throw new Error("local Tauri/Vite tooling is missing. Run npm install.", { cause: error }); });
  assertMemoryAvailable();
  await acquireLock();
  try {
    const backendRecovery = await recoverWorkspaceBackend();
    const rendererPort = await allocateLoopbackPort();
    const rendererUrl = `http://127.0.0.1:${rendererPort}`;
    const env = { ...process.env, CARGO_BUILD_JOBS: "1", CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? "1" };

    console.log("[sparkly-dev] Launch safeguards active:");
    console.log(`  - renderer URL: ${rendererUrl} (ephemeral, this launch only)`);
    console.log("  - renderer identity: verified before Tauri starts");
    console.log("  - Cargo compiler jobs: 1; Rust watcher disabled");
    console.log(`  - backend 48231: available${backendRecovery.recovered ? ` after recovering PID ${backendRecovery.recovered}` : ""}\n`);

    const vite = spawnOwned(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(rendererPort), "--strictPort"]);
    const viteFailure = new Promise((_, reject) => vite.once("exit", (code, signal) => reject(new Error(`Vite exited before readiness (code ${code}, signal ${signal ?? "none"}).`))));
    await Promise.race([waitForRenderer(rendererUrl), viteFailure]);

    const passthroughArgs = process.argv.slice(2);
    const tauri = spawnOwned(process.execPath, [tauriCli, "dev", "--no-watch", "--no-dev-server-wait", "--config", tauriConfigOverlay(rendererUrl), ...passthroughArgs], { env });
    const result = await new Promise((resolve, reject) => {
      tauri.once("error", reject);
      tauri.once("exit", (code, signal) => resolve({ code, signal }));
    });
    process.exitCode = result.signal ? (stopping ? 0 : 1) : (result.code ?? 1);
  } finally {
    await stopChildren();
    await removeOwnedLock();
  }
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(currentFile)) {
  process.once("SIGINT", () => void forwardSignal("SIGINT"));
  process.once("SIGTERM", () => void forwardSignal("SIGTERM"));
  try { await main(); }
  catch (error) { await stopChildren(); await removeOwnedLock(); fail(error instanceof Error ? error.message : String(error)); }
}
