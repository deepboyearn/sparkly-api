<div align="center">

# ⚡ Sparkly API

### *High-Performance OpenAI-Compatible Local Bridge Proxy & API Dashboard*

[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri_2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

<p align="center">
  <b>Sparkly API</b> connects your favorite local apps, AI clients (like Open WebUI, Cursor, Continue), and scripts directly to custom upstream LLM providers, offering unified proxy management, playground testing, key security, and real-time request analytics.
</p>

---

</div>

## 🌟 Key Features

- 🔄 **OpenAI-Compatible Local Bridge**  
  Exposes standardized `/v1/chat/completions`, `/v1/models`, `/v1/responses`, `/health`, and `/stats` endpoints at the permanent client URL `http://localhost:48231`.

- 🔑 **Multi-Account & Upstream Provider Management**  
  Manage account-scoped catalogs and selections across Auto detect, OpenAI-compatible, Anthropic, Gemini, Ollama, Cohere, and v0 providers.

- 🔐 **Client Key Management**
  Create and manage local `sk-...` API keys with masking, stored with `0600` permissions.

- 🧪 **Built-in AI Playground**
  Test models directly inside the dashboard with custom system prompts and raw JSON request/response inspection.

- 📊 **Real-time Usage & Logs Analytics**
  Track request counts, response latencies, success rates, and per-request logs.

- 🦀 **Rust Backend, Native Desktop App**
  The bridge, config store, and provider failover run in Rust inside a Tauri 2 shell — a single small binary with no bundled browser engine.

---

## Complete App Fix — work completed from start to finish

This section is the simple handoff record for the `Complete-app-fix` release. It explains what was wrong, what was changed, and what the current application now does.

### 1. We audited the whole application

- Traced the React dashboard, Tauri desktop shell, Rust bridge, configuration files, API routes, MITM listener, model flow, build scripts, and deleted tests.
- Confirmed that old Electron code had already been removed, then removed the remaining Electron-era names, buttons, comments, and assumptions.
- Found the main reliability, security, performance, model-discovery, UI, and development-launch problems before changing the architecture.

### 2. We made the local API endpoint predictable

- Sparkly now binds only to `127.0.0.1:48231`.
- Users and client applications always use `http://localhost:48231`.
- Removed the old automatic `48232` fallback and all silent port switching.
- Server restart operations wait for the fixed listener to come back instead of reporting success too early.
- Account edits no longer restart the local API unnecessarily.

### 3. We prevented duplicate desktop and backend instances

- Added Tauri single-instance handling.
- A second launch restores and focuses the existing Sparkly window instead of starting another bridge.
- Removed the old elevation flow that could relaunch the complete application as a second process.
- Closing the main window now keeps Sparkly running in the system tray.
- The tray menu can restore the window or explicitly quit Sparkly and stop its services cleanly.

### 4. We permanently fixed development-app collisions

- Development no longer depends on a shared fixed frontend port such as `1420`.
- `npm run dev` allocates a fresh loopback renderer port for every launch.
- The launcher starts its exact Vite child, verifies Sparkly's HTML identity, and passes that exact URL to Tauri using a runtime config overlay.
- The renderer verifies a Sparkly-only native command identity before mounting the real interface.
- A browser, stale server, another Tauri application, or a foreign WebView cannot display a fake disconnected copy of Sparkly.
- The tracked Tauri development URL intentionally fails closed; use `npm run dev`, not direct `tauri dev`.
- The launcher owns and stops only the exact children it created and never performs global process-name or process-tree killing.

### 5. We made Rust development safer for normal computers

- Limited Cargo to one compiler job through `.cargo/config.toml` and the guarded launcher.
- Disabled the extra Rust development watcher while keeping Vite hot reload.
- Reduced development debug/code-generation memory cost.
- Changed Rustls and Tokio-Rustls to explicit Ring-only features.
- Removed the unintended AWS-LC/CMake native build path that caused the original extremely heavy cold build.
- Added memory, lock, process-ownership, stale-backend, and port-safety checks to the launcher.

### 6. We repaired configuration and secret handling

- Configuration replacement is atomic and safe on Windows and Unix-like systems.
- Temporary private files are cleaned up after failures.
- CORS is disabled by default instead of being open to every website.
- `/stats` and `/logs` require a valid Sparkly client key.
- `/health` returns only basic non-sensitive service information.
- Console logging recursively redacts API keys, authorization headers, tokens, passwords, and secrets.
- Runtime polling now fetches only changing stats and logs instead of repeatedly copying full secret-bearing application state.

### 7. We rebuilt model discovery and account ownership

- Every upstream account now owns its exact model catalog, selected model, detected protocol, and last scan time.
- Switching accounts switches the catalog and selected model correctly.
- Scans replace the catalog with the provider's real response instead of merging hardcoded models.
- Provider-qualified IDs are preserved, searchable, displayed, and sent exactly as returned.
- The configured model endpoint is authoritative and gets a longer bounded timeout before fallback routes are tried.
- Large catalogs support full search and automatic rendering in batches of 100 without hiding later results.
- Legacy or partially populated saved accounts are normalized safely instead of crashing the renderer.

### 8. We added protocol-aware provider support

- Added explicit support for Auto detect, OpenAI-compatible APIs, Anthropic, Gemini, Ollama, Cohere, and v0.
- Read-only model discovery understands OpenAI/Mistral/Together arrays, Anthropic catalogs, Gemini resources, Ollama tags, Cohere catalogs, and router `/api/models` responses.
- Auto-detected protocol information is saved with the account.
- Generation uses one resolved protocol and never replays a potentially billable request across unrelated protocols.
- Added native non-streaming adapters for Gemini, Ollama, and Cohere while preserving OpenAI and Anthropic routing.
- Route fallback happens only for proven missing routes, not for authentication, quota, validation, model, or server errors.

### 9. We upgraded the Playground

- Added protocol selection, account selection, model discovery, exact base URL, API key, and full model search.
- Added max tokens, temperature, top-p, seed, stop sequences, reasoning effort, thinking modes and budget, response format, and advanced JSON override.
- Requests are validated before being sent.
- No hidden context-management or thinking parameters are injected.
- The UI shows the exact normalized request, resolved endpoint, provider error, parsed response, and raw response.
- Playground drafts no longer reset after unrelated saves, polling, key changes, or completed requests.
- Rebuilt the layout as a compact prompt/response workspace with progressive connection and settings controls.

### 10. We rebuilt the MITM path and interface

- The MITM listener binds only to `127.0.0.1:443`.
- Startup reports success only after the listener has actually bound.
- Added bounded concurrent connections, TLS handshake timeout, I/O timeout, upstream timeout, header limit, and body limit.
- Uses one shared pooled HTTP client instead of creating a client per request.
- TLS advertises only HTTP/1.1 because that is what the implementation supports.
- SSE is forwarded chunk by chunk instead of being buffered or having a fake `[DONE]` appended.
- Certificate resolution now uses deterministic synchronization rather than opportunistic locking.
- Removed the fake DNS Start/Stop control; hosts-file changes are clearly described as manual.
- MITM model targets come only from the selected account's scanned catalog.
- Stale mappings are detected, edits are staged, and only validated mappings are saved.
- Rebuilt the MITM page using the same cards, buttons, badges, typography, spacing, and responsive behavior as the rest of Sparkly.

### 11. We removed fabricated analytics

- Removed token, cost, points, balance, cache, reasoning, TPS, and rate-limit numbers that were derived from latency or hardcoded values.
- Unknown provider usage is shown truthfully as zero until real provider-reported usage exists.
- Traffic cards now describe observed local activity instead of claiming a fake fixed limit.

### 12. We improved UI behavior and performance

- Added visible progress, success, and error feedback for application actions.
- Notifications are opaque, only one is shown at a time, and each new message resets the five-second dismissal timer.
- Fixed Windows dropdown option contrast.
- Added searchable custom account/model selectors and responsive layouts.
- Replaced full Iconify collection bundling with a generated Solar subset containing only icons used by the renderer.
- Reduced the main production JavaScript bundle from about 15.19 MB to about 604 KB before gzip.
- Split major pages into lazy-loaded chunks.

### 13. We added the Sparkly automation CLI

- Added `scripts/sparkly-cli.mjs` and the `sparkly` package command.
- Supports health, models, chat, streaming, Responses, Anthropic Messages, arbitrary requests, diagnostics, app status, accounts, config, and client-key administration.
- Commands are non-interactive, time-bounded, redact secrets by default, return deterministic exit codes, and support JSON output.
- Persisted mutations use a lock and atomic replacement and are offline by default.
- Added provider and bridge doctor checks plus regression tests for endpoint fallback, authoritative model discovery, no request replay, redaction, and atomic state changes.

### 14. We restored the safety net

- Removed Cargo test declarations that pointed to deleted files.
- Added module-local Rust regression tests for configuration, persistence, model extraction, protocol handling, and streaming detection.
- Added launcher tests for ephemeral ports, runtime config overlays, foreign process refusal, and the original cross-application renderer collision.
- Added CLI tests for route shapes, model catalogs, HTTP failures, redaction, mutations, and exit codes.

### 15. Final verification completed for this release

The following checks passed during the remediation work:

- `npm run typecheck`
- `npm run lint` with warnings only and no lint errors
- `npm run build`
- `npm run cli:test`
- `npm run dev:test`
- `cargo check --lib --jobs 1`
- `cargo test --lib --jobs 1`
- Resource-constrained native debug builds with one Cargo job
- `git diff --check`
- Changed-file secret scan

The production build still reports a warning that the main JavaScript chunk is above Vite's default 500 KB warning threshold. It is approximately 604 KB before gzip and 197 KB after gzip, which is dramatically smaller than the original bundle but remains a future code-splitting opportunity.

### Handoff: how to get this exact release

After the release tag has been pushed, a friend can clone the repository and check out this exact state with:

```bash
git clone https://github.com/deepboyearn/sparkly-api.git
cd sparkly-api
git checkout Complete-app-fix
npm install
npm run dev
```

To return to the normal latest branch later:

```bash
git switch main
git pull
```

The `Complete-app-fix` tag belongs to the Sparkly repository only. The Atessa Endpoint cross-application launcher/runtime-identity fix was made in the separate `MrAlony/atessa-endpoint` repository and must be committed and released from that repository independently.

---

## 🛠️ System Architecture

```
┌─────────────────────────┐   Local Requests    ┌────────────────────────────────────┐
│   Clients & Tooling     │ ──────────────────► │  Bridge server (Rust / axum)       │
│ (Open WebUI, Apps, CLI) │ ◄────────────────── │  localhost:48231                   │
└─────────────────────────┘                     └────────────────────────────────────┘
                                                        ▲                  │
┌─────────────────────────┐   Tauri IPC (invoke)         │                  │ upstream
│  Dashboard (React 19)   │ ─────────────────────────────┘                  │ request
│  in the Tauri WebView   │   no HTTP control plane                         ▼
└─────────────────────────┘                     ┌────────────────────────────────────┐
                                                │       Upstream AI Providers        │
                                                │  (OpenAI-compatible / v0 / custom) │
                                                └────────────────────────────────────┘
```

The dashboard talks to the backend over Tauri IPC. Packaged builds expose only
the OpenAI-compatible bridge. In development, the guarded launcher allocates an
ephemeral loopback renderer port for each run and injects that exact URL into
Tauri. Config and client keys live in the app data directory with private file
permissions.

---

## 🚀 Quick Start Guide

### 1. Prerequisites

- **Rust**: stable toolchain ([rustup](https://rustup.rs))
- **Node.js**: `v20` or higher
- **Linux only**: `webkit2gtk-4.1`, `gtk3`, `librsvg`
  ```bash
  # Arch
  sudo pacman -S webkit2gtk-4.1 gtk3 librsvg
  # Debian/Ubuntu
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev
  ```

See the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for
macOS and Windows.

### 2. Installation

```bash
git clone https://github.com/deepboyearn/sparkly-api.git
cd sparkly-api
npm install
```

### 3. Running in Development Mode

```bash
npm run dev
```

This uses Sparkly's guarded development launcher. It refuses concurrent launcher
sessions, allocates a fresh loopback renderer port, verifies Sparkly's content
identity before Tauri starts, injects the exact URL using a runtime Tauri config
overlay, checks fixed client API port `48231`, verifies available memory, limits
Cargo to one compiler job, and disables Rust file watching. A stale Sparkly
backend from this exact workspace may be stopped by exact PID; unrelated or
unverifiable owners are never terminated. Vite HMR remains enabled for
frontend work. The first Rust build can still take time, but it must not fan out
into hundreds of compiler/CMake processes.

The launcher never uses `taskkill /T`, kills by process name, or terminates
unrelated processes. Self-healing is deliberately limited to command lines and
native executable paths that prove ownership by this repository. If it reports low available memory, close memory-intensive
programs and retry. `SPARKLY_ALLOW_LOW_MEMORY=1` deliberately bypasses only the
memory preflight; Cargo remains limited to one job.

The launcher opens the desktop window. The Rust bridge exclusively listens on
`127.0.0.1:48231`, and the canonical client URL shown throughout the product is
`http://localhost:48231`.

### 4. Building a Release Binary

```bash
npm run tauri:build
```

Bundles land in `src-tauri/target/release/bundle/`.

---

### Background operation

Closing the Sparkly API window hides it to the system tray while the local bridge continues running. Use the tray icon to restore the dashboard, or choose **Quit Sparkly API** from the tray menu to stop the bridge and exit cleanly.

Model catalogs are stored per upstream account. **Scan models** replaces the active account catalog with the exact provider response and account switching switches the visible catalog automatically.

## 📡 API Reference & Endpoints

Connect any OpenAI-compatible client (Cursor, Open WebUI, LangChain, AutoGen, Custom Scripts) to Sparkly API using the following endpoints:

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `http://localhost:48231/v1/chat/completions` | `POST` | OpenAI-compatible chat completion proxy |
| `http://localhost:48231/v1/models` | `GET` | Returns list of configured & active models |
| `http://localhost:48231/v1/responses` | `POST` | OpenAI Responses API emulation (supports `stream: true`) |
| `http://localhost:48231/health` | `GET` | Health check endpoint returning server status |
| `http://localhost:48231/stats` | `GET` | Authenticated usage analytics & request statistics |
| `http://localhost:48231/logs` | `GET` | Authenticated recent request logs |

### 💡 Example Curl Request

```bash
curl http://localhost:48231/v1/chat/completions \
  -H "Authorization: Bearer <your-sparkly-client-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [
      {
        "role": "user",
        "content": "Hello! Explain quantum computing in 2 sentences."
      }
    ]
  }'
```

---

## Sparkly CLI

Sparkly includes a dependency-free Node.js automation CLI inspired by Unity's
batch tooling: every invocation is non-interactive, time-bounded, emits a
deterministic exit code, and can return one structured JSON document.

```bash
# Full provider + running bridge diagnostics
npm run cli -- doctor all \
  --provider-url http://localhost:20128/v1 \
  --api-key no_api_key \
  --json

# Discover a router or OpenAI-compatible model catalog
npm run cli -- models provider --provider-url http://localhost:20128/v1

# Direct provider request; add --target bridge to test Sparkly instead
npm run cli -- chat "Reply exactly OK" \
  --provider-url http://localhost:20128/v1 \
  --api-key no_api_key \
  --model qwen3.5-plus

# Arbitrary authenticated bridge request
npm run cli -- request GET /stats --target bridge --api-key <sparkly-client-key>
```

The CLI and Rust bridge accept root URLs, URLs already ending in `/v1`, custom
prefixes, and router-style `/api/v1` deployments. Read-only model discovery is
protocol-aware across OpenAI-compatible/Together/Mistral shapes, Anthropic,
Gemini, Ollama, Cohere, and router `/api/models` catalogs. Accounts set to
**Auto detect** persist the protocol that produced the catalog. Generation uses
only that resolved protocol and sends one billable request; alternate protocol
probing is never used to replay authentication, quota, model, validation, or
server responses. Native Gemini, Ollama, and Cohere accounts accept non-streaming
OpenAI-compatible chat requests through the local bridge; use the Playground for
provider-native advanced controls.

`doctor provider` validates health, catalog discovery, OpenAI chat, SSE,
Responses, and Anthropic Messages. `doctor bridge` additionally validates local
auth rejection, malformed JSON handling, models, stats, and logs. Use `--strict`
to treat unsupported/skipped capabilities as failure. Exit codes are `0` for
success, `1` for a failed request/check, `2` for CLI usage errors, and `4` for
network or timeout errors.

Persisted administration is available through `app status`, `config`,
`accounts`, and `keys`. Secrets are masked unless `--reveal-secrets` is
explicit. Mutations use a lock and atomic private-file replacement and are
offline by default: stop the desktop app first so its in-memory state cannot
overwrite the CLI change. `--force` overrides only that guard and always reports
that a restart is required.

---

## 📦 Building Release Binaries

```bash
npm run tauri:build
```

Output lands in `src-tauri/target/release/bundle/` — `.deb`/`.rpm`/AppImage on
Linux, `.msi`/NSIS on Windows, `.dmg` on macOS. Cross-compiling is not
supported; build each target on its own platform.

---

## ⚙️ Configuration & Environment

| Setting | Default Value | Description |
| :--- | :--- | :--- |
| **Local Endpoint** | `http://localhost:48231` | Permanent client URL; Rust binds to `127.0.0.1:48231` |
| **Enable CORS** | `false` | Opt-in only; native and CLI clients do not require browser CORS |
| **Upstream Base URL** | Configurable | Base URL for your LLM API service |
| **Selected Model** | Provider catalog selection | Stored separately for each upstream account |

---

## Build safety and generated lockfiles

Project-local Cargo configuration limits compilation to one job. The TLS stack
explicitly selects Ring and disables Rustls default features, preventing the
unintended AWS-LC/CMake native build that previously caused extreme cold-build
resource usage.

`Cargo.lock` is generated by Cargo and may temporarily retain packages that are
no longer reachable after manifest changes. Cargo will reconcile it during the
next guarded development or release build; registry checksums must never be
hand-written. Stop a build normally with `Ctrl+C` in its launching terminal;
do not kill process trees or compiler processes globally.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!  
Feel free to check the [Issues Page](https://github.com/deepboyearn/sparkly-api/issues).

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push -u origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

<div align="center">
  <sub>Built with ❤️ by Sparkly Team</sub>
</div>