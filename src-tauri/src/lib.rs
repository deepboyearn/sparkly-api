// src-tauri/src/lib.rs
// Tauri app setup — all command signatures, state management, bridge lifecycle.
// config.rs and bridge.rs provide the implementations.

pub mod types;
pub mod config;
pub mod bridge;
pub mod tools;
pub mod trust_store;
pub mod mitm_server;
pub mod model_mapper;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::{Mutex, RwLock};
use types::*;
use std::collections::HashMap;

// ─── Cross-Platform Elevation ────────────────────────────────────────────────

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

/// Request elevation: re-launch with admin/root privileges.
/// Returns Ok(true) if elevated instance launched, Ok(false) if user declined.
pub fn request_elevation() -> Result<bool, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_str().ok_or("exe path not valid UTF-8")?;

    #[cfg(target_os = "windows")]
    {
        windows_request_elevation(exe_str)
    }

    #[cfg(target_os = "linux")]
    {
        linux_request_elevation(exe_str)
    }

    #[cfg(target_os = "macos")]
    {
        macos_request_elevation(exe_str)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Err("Elevation not supported on this platform".into())
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

#[cfg(target_os = "windows")]
fn windows_request_elevation(exe: &str) -> Result<bool, String> {
    use std::ffi::c_void;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    type HANDLE = *mut c_void;

    #[link(name = "user32")]
    extern "system" {
        fn ShellExecuteW(hwnd: HANDLE, lpOperation: *const u16, lpFile: *const u16,
                         lpParameters: *const u16, lpDirectory: *const u16, nShowCmd: i32) -> HANDLE;
    }

    let to_wide = |s: &str| -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    };

    unsafe {
        let verb = to_wide("runas");
        let file = to_wide(exe);
        let empty = to_wide("");
        let result = ShellExecuteW(
            std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(),
            empty.as_ptr(), empty.as_ptr(), 1,
        );
        if (result as usize) > 32 { Ok(true) } else { Ok(false) }
    }
}

// ── Linux ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn linux_request_elevation(exe: &str) -> Result<bool, String> {
    // Try pkexec first (standard Polkit prompt — GNOME/KDE/XFCE)
    if command_exists("pkexec") {
        std::process::Command::new("pkexec")
            .arg(exe)
            .spawn()
            .map_err(|e| format!("pkexec failed: {e}"))?;
        return Ok(true);
    }

    // Fallback: gksudo (GNOME2 / some XFCE)
    if command_exists("gksudo") {
        std::process::Command::new("gksudo")
            .args(["--", exe])
            .spawn()
            .map_err(|e| format!("gksudo failed: {e}"))?;
        return Ok(true);
    }

    // Fallback: kdesudo (KDE)
    if command_exists("kdesudo") {
        std::process::Command::new("kdesudo")
            .args(["-c", exe])
            .spawn()
            .map_err(|e| format!("kdesudo failed: {e}"))?;
        return Ok(true);
    }

    Err("No elevation tool found (pkexec/gksudo/kdesudo). Run with: sudo ./sparkly-api".into())
}

#[cfg(target_os = "linux")]
fn command_exists(cmd: &str) -> bool {
    std::process::Command::new("which")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ── macOS ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn macos_request_elevation(exe: &str) -> Result<bool, String> {
    // osascript shows the native macOS "Password" dialog
    let script = format!(
        "do shell script \"\\\"{}\\\"\" with administrator privileges",
        exe.replace('\\', "\\\\").replace('"', "\\\"")
    );

    let output = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("osascript failed: {e}"))?;

    if output.status.success() {
        Ok(true)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("(-128)") {
            Ok(false) // User clicked Cancel
        } else {
            Err(format!("macOS elevation failed: {stderr}"))
        }
    }
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
    pub model_mappings: RwLock<HashMap<String, String>>,
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
                data_dir: data_dir.clone(),
                mitm_running: RwLock::new(false),
                mitm_shutdown_tx: Mutex::new(None),
                model_mappings: RwLock::new(model_mapper::default_mappings()),
            };

            let state_arc = Arc::new(state);

            // Supervise the bridge listener: `bridge::spawn_supervisor` keeps it
            // alive across restarts, so a config change re-binds instead of
            // killing the server for the rest of the session.
            bridge::spawn_supervisor(state_arc.clone());

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
            trust_mitm_cert,
            untrust_mitm_cert,
            get_mitm_cert_status,
            start_mitm_server_cmd,
            stop_mitm_server_cmd,
            update_mitm_model_mappings,
            get_mitm_model_mappings,
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
    {
        let mut cfg = state.config.write().await;
        *cfg = config;
        config::save_config(&mut cfg, &state.data_dir).map_err(|e| e.to_string())?;
    }
    // localPort / enableCors may have changed — re-bind the listener.
    bridge::request_rebind().await;
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn restart_server(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    {
        let conf = config::load_config(&state.data_dir);
        let mut cfg = state.config.write().await;
        *cfg = conf;
    }
    bridge::request_rebind().await;
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
    bridge::request_rebind().await;
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
    bridge::request_rebind().await;
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
    bridge::request_rebind().await;
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
    bridge::request_rebind().await;
    Ok(bridge::build_bridge_state(&state).await)
}

#[tauri::command]
async fn refresh_active_account_models(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<BridgeState, String> {
    // Mirrors `syncActiveAccountModels` (src/main/main.ts:93-122): v0 has a
    // fixed catalog, everything else is fetched from the provider.
    let (provider, base_url, api_key) = {
        let cfg = state.config.read().await;
        match config::get_active_account(&cfg) {
            Some(a) => (a.provider.clone(), a.base_url.clone(), a.api_key.clone()),
            None => return Err("No active account is configured.".into()),
        }
    };

    if base_url.is_empty() || api_key.is_empty() {
        return Err("The active account needs a base URL and an API key.".into());
    }

    let models = if provider == AccountProvider::V0 {
        V0_MODELS.iter().map(|m| (*m).to_string()).collect()
    } else {
        bridge::fetch_models_from_provider(&base_url, &api_key).await?
    };

    {
        let mut cfg = state.config.write().await;
        cfg.models = models;
        // save_config re-normalizes, so selectedModel stays valid against the
        // new list.
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
    bridge::fetch_playground_models(&input.base_url, &input.api_key).await
}

#[tauri::command]
async fn playground_test(
    input: PlaygroundTestInput,
) -> Result<PlaygroundTestResult, String> {
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
            // Permission denied → request elevation
            if msg.contains("Permission denied") || msg.contains("Operation not permitted")
                || msg.contains("EACCES") || msg.contains("access denied")
            {
                tracing::info!("Trust requires elevation: {msg}");
                match request_elevation() {
                    Ok(true) => return Err("ADMIN_ELEVATION_REQUESTED".into()),
                    Ok(false) => return Err("User declined elevation. Certificate trust requires administrator.".into()),
                    Err(elev_err) => return Err(format!("Elevation failed: {elev_err}\n\nAlternatively, run:\nsudo update-ca-certificates")),
                }
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
            if msg.contains("Permission denied") || msg.contains("Operation not permitted")
                || msg.contains("EACCES") || msg.contains("access denied")
            {
                match request_elevation() {
                    Ok(true) => return Err("ADMIN_ELEVATION_REQUESTED".into()),
                    Ok(false) => return Err("User declined elevation.".into()),
                    Err(elev_err) => return Err(format!("Elevation failed: {elev_err}")),
                }
            }
            return Err(msg);
        }
    }
}

#[tauri::command]
async fn get_mitm_cert_status(state: tauri::State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let exists = trust_store::cert_exists(&state.data_dir);
    let trusted = trust_store::is_trusted(&state.data_dir);
    Ok(serde_json::json!({
        "exists": exists,
        "trusted": trusted,
    }))
}

// ─── MITM Server Commands ────────────────────────────────────────────────────

#[tauri::command]
async fn start_mitm_server_cmd(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let running = *state.mitm_running.read().await;
    if running {
        return Ok(true);
    }

    // ── Cross-platform: check elevation, request if needed ──
    if !is_elevated() {
        tracing::info!("Requesting elevation for MITM server (port 443 requires root/admin)...");
        match request_elevation() {
            Ok(true) => {
                return Err("ADMIN_ELEVATION_REQUESTED".into());
            }
            Ok(false) => {
                return Err("User declined elevation. Port 443 requires administrator/root.".into());
            }
            Err(e) => {
                return Err(format!("Elevation failed: {e}\n\nAlternatively, run the app as root:\nsudo ./sparkly-api"));
            }
        }
    }

    // Ensure CA cert exists
    trust_store::get_or_generate_ca(&state.data_dir).map_err(|e| e.to_string())?;

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let data_dir = state.data_dir.clone();

    {
        let mut tx = state.mitm_shutdown_tx.lock().await;
        *tx = Some(shutdown_tx);
    }
    {
        let mut running = state.mitm_running.write().await;
        *running = true;
    }

    let running_flag = Arc::new(tokio::sync::RwLock::new(true));
    let flag_clone = running_flag.clone();

    let mappings_clone = {
        let mappings = state.model_mappings.read().await;
        Arc::new(tokio::sync::RwLock::new(mappings.clone()))
    };
    // Forward to the bridge's actual listening URL (client base URL), not a
    // hardcoded port — keeps local dev and the client on the same base URL.
    let upstream_url = {
        let stats = state.stats.read().await;
        let base = stats.local_base_url.clone();
        if base.is_empty() {
            format!("http://localhost:{}", state.config.read().await.local_port)
        } else {
            base
        }
    };
    tokio::spawn(async move {
        let result = mitm_server::start_mitm_server(data_dir, 443, shutdown_rx, mappings_clone, upstream_url).await;
        if let Err(e) = result {
            tracing::error!("MITM server failed: {e}");
        }
        let mut flag = flag_clone.write().await;
        *flag = false;
    });

    // Poll until the server is either started or failed
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        if !*running_flag.read().await {
            let mut running = state.mitm_running.write().await;
            *running = false;
            return Err("MITM server failed to start — check port 443 permissions".into());
        }
        let running = *state.mitm_running.read().await;
        if running {
            return Ok(true);
        }
    }

    Ok(true)
}

#[tauri::command]
async fn stop_mitm_server_cmd(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<bool, String> {
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
