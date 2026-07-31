// src-tauri/src/lib.rs
// Tauri app setup — all command signatures, state management, bridge lifecycle.
// config.rs and bridge.rs provide the implementations.

pub mod types;
pub mod config;
pub mod bridge;
pub mod tools;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;
use types::*;

pub struct AppState {
    pub config: RwLock<BridgeConfig>,
    pub client_keys: RwLock<Vec<ClientApiKey>>,
    pub logs: RwLock<Vec<RequestLogEntry>>,
    pub stats: RwLock<BridgeStats>,
    pub started_at: std::time::Instant,
}

pub fn run() {
    // WebKitGTK on NVIDIA + Wayland crashes with
    // "Error 71 (Protocol error) dispatching to Wayland display" unless the
    // DMA-BUF renderer is disabled. That single variable fixes the crash while
    // leaving GPU rasterisation intact.
    //
    // NOTE: do NOT set LIBGL_ALWAYS_SOFTWARE / GALLIUM_DRIVER=llvmpipe here.
    // Forcing software GL pushes all compositing onto the CPU and drops the
    // dashboard to single-digit FPS.
    #[cfg(target_os = "linux")]
    if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }

    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            let conf = config::load_config(&data_dir);
            let client_keys = config::load_client_keys(&data_dir);

            let state = AppState {
                config: RwLock::new(conf),
                client_keys: RwLock::new(client_keys),
                logs: RwLock::new(Vec::new()),
                stats: RwLock::new(BridgeStats {
                    total_requests: 0,
                    success_count: 0,
                    error_count: 0,
                    active_model_count: 0,
                    last_request_at: None,
                    uptime_ms: 0,
                    local_base_url: String::new(),
                    server_running: false,
                }),
                started_at: std::time::Instant::now(),
            };

            let state_arc = Arc::new(state);

            // Start bridge HTTP server in background
            let bridge_state = state_arc.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = bridge::start_bridge_server(bridge_state).await {
                    tracing::error!("Bridge server stopped: {error}");
                }
            });

            app.manage(state_arc);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            save_config,
            restart_server,
            create_client_key,
            update_client_key,
            delete_client_key,
            create_account,
            update_account,
            delete_account,
            select_account,
            refresh_active_account_models,
            reset_usage,
            playground_load_models,
            playground_test,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
async fn get_state(state: tauri::State<'_, Arc<AppState>>) -> Result<BridgeState, String> {
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn save_config(
    config: BridgeConfig,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let mut cfg = state.config.write().await;
    *cfg = config::normalize_config(config);
    config::persist_config(&cfg, &data_dir).map_err(|e| e.to_string())?;
    drop(cfg);
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn restart_server(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let conf = config::load_config(&data_dir);
    let mut cfg = state.config.write().await;
    *cfg = conf;
    drop(cfg);
    // Server restart is handled by the bridge module
    bridge::restart().await.map_err(|e| e.to_string())?;
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn create_client_key(
    input: CreateClientKeyInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let mut keys = state.client_keys.write().await;
    let new_key = config::create_client_key(&mut keys, &input.name);
    let _ = new_key; // already pushed into keys
    config::persist_client_keys(&keys, &data_dir).map_err(|e| e.to_string())?;
    drop(keys);
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn update_client_key(
    input: UpdateClientKeyInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let mut keys = state.client_keys.write().await;
    config::update_client_key(&mut keys, &input.id, &input.name);
    config::persist_client_keys(&keys, &data_dir).map_err(|e| e.to_string())?;
    drop(keys);
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn delete_client_key(
    input: DeleteClientKeyInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let mut keys = state.client_keys.write().await;
    config::delete_client_key(&mut keys, &input.id);
    config::persist_client_keys(&keys, &data_dir).map_err(|e| e.to_string())?;
    drop(keys);
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn create_account(
    input: CreateAccountInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let mut cfg = state.config.write().await;
    config::create_account(&mut cfg, &input);
    config::persist_config(&cfg, &data_dir).map_err(|e| e.to_string())?;
    drop(cfg);
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn update_account(
    input: UpdateAccountInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let mut cfg = state.config.write().await;
    config::update_account(&mut cfg, &input);
    config::persist_config(&cfg, &data_dir).map_err(|e| e.to_string())?;
    drop(cfg);
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn delete_account(
    input: DeleteAccountInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let mut cfg = state.config.write().await;
    config::delete_account(&mut cfg, &input.id);
    config::persist_config(&cfg, &data_dir).map_err(|e| e.to_string())?;
    drop(cfg);
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn select_account(
    input: SelectAccountInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let mut cfg = state.config.write().await;
    config::select_account(&mut cfg, &input.id);
    config::persist_config(&cfg, &data_dir).map_err(|e| e.to_string())?;
    drop(cfg);
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn refresh_active_account_models(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let data_dir = config_store_path();
    let cfg = state.config.read().await;
    let account = config::get_active_account(&cfg);
    let (base_url, api_key) = match account {
        Some(a) => (a.base_url.clone(), a.api_key.clone()),
        None => return Err("No active account".into()),
    };
    drop(cfg);

    let models = bridge::fetch_models_from_provider(&base_url, &api_key).await?;

    let mut cfg = state.config.write().await;
    cfg.models = models;
    config::persist_config(&cfg, &data_dir).map_err(|e| e.to_string())?;
    drop(cfg);
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn reset_usage(
    input: ResetUsageInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    if !input.confirm {
        return Err("Reset not confirmed".into());
    }
    let mut logs = state.logs.write().await;
    logs.clear();
    drop(logs);
    let mut stats = state.stats.write().await;
    stats.total_requests = 0;
    stats.success_count = 0;
    stats.error_count = 0;
    stats.last_request_at = None;
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn playground_load_models(
    input: PlaygroundModelsInput,
) -> Result<PlaygroundModelsResult, String> {
    bridge::fetch_playground_models(&input.base_url, &input.api_key).await
}

#[tauri::command]
async fn playground_test(
    input: PlaygroundTestInput,
) -> Result<PlaygroundTestResult, String> {
    bridge::playground_test(input).await
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn config_store_path() -> std::path::PathBuf {
    // In Tauri, data lives in the app data dir.
    // During development, fallback to current dir + "sparkly-data".
    std::env::var("APPDATA")
        .map(|p| std::path::PathBuf::from(p).join("sparkly-api"))
        .unwrap_or_else(|_| {
            dirs().unwrap_or_else(|| std::path::PathBuf::from(".")).join("sparkly-api")
        })
}

fn dirs() -> Option<std::path::PathBuf> {
    home::home_dir().map(|h| h.join("sparkly-api"))
}
