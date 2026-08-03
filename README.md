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
  Exposes standardized `/v1/chat/completions`, `/v1/models`, `/v1/responses`, `/health`, and `/stats` endpoints on a configurable local port.

- 🔑 **Multi-Account & Upstream Provider Management**  
  Manage multiple API accounts seamlessly. Support for OpenAI-compatible providers, v0 endpoints, custom base URLs, and custom model lists (`gpt-5`, `claude-sonnet-4-5`, `deepseek-reasoner`, `qwen3.6-plus`, etc.).

- 🔐 **Client Key Management**
  Create and manage local `sk-...` API keys with masking, stored with `0600` permissions.

- 🧪 **Built-in AI Playground**
  Test models directly inside the dashboard with custom system prompts and raw JSON request/response inspection.

- 📊 **Real-time Usage & Logs Analytics**
  Track request counts, response latencies, success rates, and per-request logs.

- 🦀 **Rust Backend, Native Desktop App**
  The bridge, config store, and provider failover run in Rust inside a Tauri 2 shell — a single small binary with no bundled browser engine.

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

The dashboard talks to the backend over Tauri IPC, so the only open port is the
OpenAI-compatible bridge itself. Config and client keys live in the app data
directory with `0600` permissions.

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

This starts Vite for the dashboard and compiles the Rust backend, then opens the
desktop window. The bridge listens on `http://localhost:48231` by default
(configurable in the dashboard).

### 4. Building a Release Binary

```bash
npm run tauri:build
```

Bundles land in `src-tauri/target/release/bundle/`.

---

## 📡 API Reference & Endpoints

Connect any OpenAI-compatible client (Cursor, Open WebUI, LangChain, AutoGen, Custom Scripts) to Sparkly API using the following endpoints:

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `http://localhost:<port>/v1/chat/completions` | `POST` | OpenAI-compatible chat completion proxy |
| `http://localhost:<port>/v1/models` | `GET` | Returns list of configured & active models |
| `http://localhost:<port>/v1/responses` | `POST` | OpenAI Responses API emulation (supports `stream: true`) |
| `http://localhost:<port>/health` | `GET` | Health check endpoint returning server status |
| `http://localhost:<port>/stats` | `GET` | Usage analytics & request statistics |
| `http://localhost:<port>/logs` | `GET` | Recent request logs |

### 💡 Example Curl Request

```bash
curl http://localhost:48231/v1/chat/completions \
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
| **Local Port** | `48231` | Port on which the local bridge server listens |
| **Enable CORS** | `true` | Allows cross-origin requests from web clients |
| **Upstream Base URL** | Configurable | Base URL for your LLM API service |
| **Default Model** | `gpt-5.4` | Selected model for incoming proxy requests |

---

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