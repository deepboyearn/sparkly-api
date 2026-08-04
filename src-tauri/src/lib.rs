// src-tauri/src/lib.rs
// Tauri app setup — all command signatures, state management, bridge lifecycle.
// config.rs and bridge.rs provide the implementations.

pub mod bridge;
pub mod config;
pub mod mitm_server;
pub mod model_mapper;
pub mod tools;
pub mod trust_store;
pub mod types;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Manager;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tokio::sync::{Mutex, RwLock};
use types::*;

static QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ─── Privilege Detection ─────────────────────────────────────────────────────

/// Check if the current process has admin/root privileges.
pub fn is_elevated() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_check_admin()
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var("PKEXEC_UID").is_ok() || std::env::var("SUDO_UID").is_ok()
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("SUDO_UID").is_ok()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        false
    }
}

// ── Windows ──────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn windows_check_admin() -> bool {
    type BOOL = i32;

    #[link(name = "shell32")]
    extern "system" {
        fn IsUserAnAdmin() -> BOOL;
    }

    unsafe { IsUserAnAdmin() != 0 }
}

/// Shared application state.
///
/// `data_dir` is the single source of truth for on-disk paths. It is resolved
/// once from Tauri's `app_data_dir()` at startup and threaded through every
/// command, so reads and writes can never disagree about where config lives.
pub struct AppState {
    pub config: RwLock<BridgeConfig>,
    pub client_keys: RwLock<Vec<ClientApiKey>>,
    pub logs: RwLock<Vec<RequestLogEntry>>,
    pub stats: RwLock<BridgeStats>,
    pub started_at: std::time::Instant,
    pub data_dir: std::path::PathBuf,
    pub mitm_running: RwLock<bool>,
    pub mitm_shutdown_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    pub mitm_generation: AtomicU64,
    pub model_mappings: Arc<RwLock<HashMap<String, String>>>,
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
        // Must be registered first so a duplicate launch cannot start another
        // bridge listener. A second launch focuses the existing desktop window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Open Sparkly API", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Sparkly API", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .expect("application icon is configured")
                        .clone(),
                )
                .tooltip("Sparkly API - local bridge running")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "quit" => {
                        QUIT_REQUESTED.store(true, Ordering::Release);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } | TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
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
                    local_base_url: format!("http://localhost:{DEFAULT_LOCAL_PORT}"),
                    server_running: false,
                }),
                started_at: std::time::Instant::now(),
                data_dir: data_dir.clone(),
                mitm_running: RwLock::new(false),
                mitm_shutdown_tx: Mutex::new(None),
                mitm_generation: AtomicU64::new(0),
                model_mappings: Arc::new(RwLock::new(model_mapper::default_mappings())),
            };

            let state_arc = Arc::new(state);

            // Supervise the single fixed bridge listener for the process lifetime.
            // Only explicit restart or listener-policy changes trigger a rebind.
            bridge::spawn_supervisor(state_arc.clone());

            app.manage(state_arc);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !QUIT_REQUESTED.load(Ordering::Acquire) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            sparkly_runtime_identity,
            get_state,
            get_runtime_snapshot,
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
            trust_mitm_cert,
            untrust_mitm_cert,
            get_mitm_cert_status,
            start_mitm_server_cmd,
            stop_mitm_server_cmd,
            update_mitm_model_mappings,
            get_mitm_model_mappings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                bridge::shutdown_supervisor();
            }
        });
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
fn sparkly_runtime_identity() -> &'static str {
    "sparkly-api:com.sparklyapi.sparklyapi:v1"
}

#[tauri::command]
async fn get_state(state: tauri::State<'_, Arc<AppState>>) -> Result<BridgeState, String> {
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn get_runtime_snapshot(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<RuntimeSnapshot, String> {
    Ok(bridge::build_runtime_snapshot(&state).await)
}

#[tauri::command]
async fn save_config(
    config: BridgeConfig,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    let cors_changed = {
        let mut cfg = state.config.write().await;
        let previous_cors = cfg.enable_cors;
        *cfg = config;
        config::save_config(&mut cfg, &state.data_dir).map_err(|e| e.to_string())?;
        previous_cors != cfg.enable_cors
    };
    if cors_changed {
        bridge::request_rebind().await?;
    }
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn restart_server(state: tauri::State<'_, Arc<AppState>>) -> Result<BridgeState, String> {
    {
        let conf = config::load_config(&state.data_dir);
        let mut cfg = state.config.write().await;
        *cfg = conf;
    }
    bridge::request_rebind().await?;
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn create_client_key(
    input: CreateClientKeyInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    {
        let mut keys = state.client_keys.write().await;
        config::create_client_key(&mut keys, &input.name);
        config::persist_client_keys(&keys, &state.data_dir).map_err(|e| e.to_string())?;
    }
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn update_client_key(
    input: UpdateClientKeyInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    {
        let mut keys = state.client_keys.write().await;
        config::update_client_key(&mut keys, &input.id, &input.name);
        config::persist_client_keys(&keys, &state.data_dir).map_err(|e| e.to_string())?;
    }
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn delete_client_key(
    input: DeleteClientKeyInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    {
        let mut keys = state.client_keys.write().await;
        config::delete_client_key(&mut keys, &input.id);
        config::persist_client_keys(&keys, &state.data_dir).map_err(|e| e.to_string())?;
    }
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn create_account(
    input: CreateAccountInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    {
        let mut cfg = state.config.write().await;
        config::create_account(&mut cfg, &input);
        config::save_config(&mut cfg, &state.data_dir).map_err(|e| e.to_string())?;
    }
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn update_account(
    input: UpdateAccountInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    {
        let mut cfg = state.config.write().await;
        config::update_account(&mut cfg, &input);
        config::save_config(&mut cfg, &state.data_dir).map_err(|e| e.to_string())?;
    }
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn delete_account(
    input: DeleteAccountInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    {
        let mut cfg = state.config.write().await;
        config::delete_account(&mut cfg, &input.id);
        config::save_config(&mut cfg, &state.data_dir).map_err(|e| e.to_string())?;
    }
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn select_account(
    input: SelectAccountInput,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    {
        let mut cfg = state.config.write().await;
        config::select_account(&mut cfg, &input.id);
        config::save_config(&mut cfg, &state.data_dir).map_err(|e| e.to_string())?;
    }
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn refresh_active_account_models(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    // v0 uses a fixed catalog; every other provider is queried dynamically.
    // Provider model lists are refreshed without restarting the local listener.
    let (provider, base_url, api_key) = {
        let cfg = state.config.read().await;
        match config::get_active_account(&cfg) {
            Some(a) => (a.provider.clone(), a.base_url.clone(), a.api_key.clone()),
            None => return Err("No active account is configured.".into()),
        }
    };

    if base_url.is_empty() {
        return Err("The active account needs a base URL.".into());
    }
    if api_key.is_empty() && !matches!(provider, AccountProvider::Auto | AccountProvider::Ollama) {
        return Err("The active account needs an API key for this protocol.".into());
    }

    let (models, detected_protocol) = if provider == AccountProvider::V0 {
        (
            V0_MODELS.iter().map(|m| (*m).to_string()).collect(),
            AccountProvider::V0,
        )
    } else {
        bridge::fetch_models_from_provider(&base_url, &api_key, provider).await?
    };

    if models.is_empty() {
        return Err("The provider returned an empty model catalog.".into());
    }

    {
        let mut cfg = state.config.write().await;
        let active_id = cfg.active_account_id.clone();
        let account_index = cfg
            .accounts
            .iter()
            .position(|account| account.id == active_id)
            .or_else(|| (!cfg.accounts.is_empty()).then_some(0))
            .ok_or_else(|| "No active account is configured.".to_string())?;
        let account = &mut cfg.accounts[account_index];
        account.models = models;
        account.detected_protocol = Some(detected_protocol);
        if !account
            .models
            .iter()
            .any(|model| model == &account.selected_model)
        {
            let previous_selection = account.selected_model.clone();
            account.selected_model = account
                .models
                .iter()
                .find(|model| model.rsplit('/').next() == Some(previous_selection.as_str()))
                .cloned()
                .or_else(|| account.models.first().cloned())
                .unwrap_or_default();
        }
        account.models_last_refreshed_at = Some(chrono::Utc::now().to_rfc3339());
        config::save_config(&mut cfg, &state.data_dir).map_err(|e| e.to_string())?;
    }
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
    state.logs.write().await.clear();
    {
        let mut stats = state.stats.write().await;
        stats.total_requests = 0;
        stats.success_count = 0;
        stats.error_count = 0;
        stats.last_request_at = None;
    }
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn playground_load_models(
    input: PlaygroundModelsInput,
) -> Result<PlaygroundModelsResult, String> {
    bridge::fetch_playground_models(&input.base_url, &input.api_key, input.protocol).await
}

#[tauri::command]
async fn playground_test(input: PlaygroundTestInput) -> Result<PlaygroundTestResult, String> {
    bridge::playground_test(input).await
}

// ─── MITM Trust Store Commands ───────────────────────────────────────────────

#[tauri::command]
async fn trust_mitm_cert(state: tauri::State<'_, Arc<AppState>>) -> Result<bool, String> {
    // Ensure CA cert exists
    trust_store::get_or_generate_ca(&state.data_dir).map_err(|e| e.to_string())?;

    // Try trust first — may succeed without elevation on some systems
    match trust_store::trust(&state.data_dir) {
        Ok(result) => return Ok(result),
        Err(e) => {
            let msg = e.to_string();
            // Do not relaunch the full application: that could create a second listener.
            if msg.contains("Permission denied")
                || msg.contains("Operation not permitted")
                || msg.contains("EACCES")
                || msg.contains("access denied")
            {
                return Err("Certificate trust requires administrator privileges. Close Sparkly API, relaunch it as administrator/root, and try again.".into());
            }
            return Err(msg);
        }
    }
}

#[tauri::command]
async fn untrust_mitm_cert(state: tauri::State<'_, Arc<AppState>>) -> Result<bool, String> {
    match trust_store::untrust(&state.data_dir) {
        Ok(result) => return Ok(result),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("Permission denied")
                || msg.contains("Operation not permitted")
                || msg.contains("EACCES")
                || msg.contains("access denied")
            {
                return Err("Removing certificate trust requires administrator privileges. Close Sparkly API, relaunch it as administrator/root, and try again.".into());
            }
            return Err(msg);
        }
    }
}

#[tauri::command]
async fn get_mitm_cert_status(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let exists = trust_store::cert_exists(&state.data_dir);
    let trusted = trust_store::is_trusted(&state.data_dir);
    let running = *state.mitm_running.read().await;
    Ok(serde_json::json!({
        "exists": exists,
        "trusted": trusted,
        "running": running,
    }))
}

// ─── MITM Server Commands ────────────────────────────────────────────────────

#[tauri::command]
async fn start_mitm_server_cmd(state: tauri::State<'_, Arc<AppState>>) -> Result<bool, String> {
    let running = *state.mitm_running.read().await;
    if running {
        return Ok(true);
    }

    if !is_elevated() {
        return Err(
            "The MITM listener on port 443 requires administrator privileges. Close Sparkly API and relaunch it as administrator/root; Sparkly will not spawn a second privileged application instance."
                .into(),
        );
    }

    trust_store::get_or_generate_ca(&state.data_dir).map_err(|e| e.to_string())?;

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let data_dir = state.data_dir.clone();
    let mappings = state.model_mappings.clone();
    let upstream_url = format!("http://localhost:{DEFAULT_LOCAL_PORT}");
    let state_arc = state.inner().clone();
    let generation = state.mitm_generation.fetch_add(1, Ordering::AcqRel) + 1;

    {
        let mut tx = state.mitm_shutdown_tx.lock().await;
        *tx = Some(shutdown_tx);
    }

    tokio::spawn(async move {
        let result = mitm_server::start_mitm_server(
            data_dir,
            443,
            shutdown_rx,
            ready_tx,
            mappings,
            upstream_url,
        )
        .await;
        if let Err(error) = result {
            tracing::error!("MITM server failed: {error}");
        }
        if state_arc.mitm_generation.load(Ordering::Acquire) == generation {
            *state_arc.mitm_running.write().await = false;
            state_arc.mitm_shutdown_tx.lock().await.take();
        }
    });

    tokio::time::timeout(std::time::Duration::from_secs(5), ready_rx)
        .await
        .map_err(|_| "Timed out while binding the MITM listener on localhost:443.".to_string())?
        .map_err(|_| "The MITM listener stopped before reporting startup status.".to_string())??;
    *state.mitm_running.write().await = true;
    Ok(true)
}

#[tauri::command]
async fn stop_mitm_server_cmd(state: tauri::State<'_, Arc<AppState>>) -> Result<bool, String> {
    let tx = {
        let mut tx = state.mitm_shutdown_tx.lock().await;
        tx.take()
    };
    if let Some(tx) = tx {
        let _ = tx.send(());
    }
    {
        let mut running = state.mitm_running.write().await;
        *running = false;
    }
    Ok(true)
}

// ─── MITM Model Mapping Commands ────────────────────────────────────────────

#[tauri::command]
async fn update_mitm_model_mappings(
    mappings: HashMap<String, String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut stored = state.model_mappings.write().await;
    *stored = mappings;
    Ok(())
}

#[tauri::command]
async fn get_mitm_model_mappings(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<HashMap<String, String>, String> {
    let mappings = state.model_mappings.read().await;
    Ok(mappings.clone())
}
