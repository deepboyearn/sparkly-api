// src-tauri/src/types.rs
// Shared type definitions — Rust equivalents of shared/types.ts
// All agents implement against these types.

use serde::{Deserialize, Serialize};

// ─── Request/Response Logging ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLogEntry {
    pub id: String,
    pub timestamp: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ─── Config ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConfig {
    pub upstream_base_url: String,
    pub api_key: String,
    pub models: Vec<String>,
    pub selected_model: String,
    #[serde(
        default = "default_local_port",
        deserialize_with = "deserialize_local_port"
    )]
    pub local_port: u16,
    #[serde(default = "default_false")]
    pub enable_cors: bool,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub accounts: Vec<UpstreamAccount>,
    #[serde(default)]
    pub active_account_id: String,
}

fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}

fn default_local_port() -> u16 {
    DEFAULT_LOCAL_PORT
}

/// `localPort` remains deserializable for compatibility with existing config
/// files, but the product endpoint is invariant. Legacy or edited values are
/// always normalized to the single supported listener port.
fn deserialize_local_port<'de, D>(deserializer: D) -> Result<u16, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let _ = Option::<f64>::deserialize(deserializer)?;
    Ok(DEFAULT_LOCAL_PORT)
}

// ─── Upstream Accounts ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamAccount {
    pub id: String,
    pub name: String,
    #[serde(default = "default_provider")]
    pub provider: AccountProvider,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected_protocol: Option<AccountProvider>,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_usage_tags")]
    pub usage_tags: Vec<String>,
    #[serde(default = "default_true")]
    pub is_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub selected_model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models_last_refreshed_at: Option<String>,
}

fn default_provider() -> AccountProvider {
    AccountProvider::Auto
}
fn default_usage_tags() -> Vec<String> {
    vec!["coding".into()]
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AccountProvider {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "openai-compatible")]
    OpenaiCompatible,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "ollama")]
    Ollama,
    #[serde(rename = "cohere")]
    Cohere,
    #[serde(rename = "v0")]
    V0,
}

pub const V0_BASE_URL: &str = "https://api.v0.dev/v1";
pub const V0_MODELS: &[&str] = &["v0-auto", "v0-mini", "v0-pro", "v0-max", "v0-max-fast"];

// ─── Client API Keys ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientApiKey {
    pub id: String,
    pub name: String,
    pub key: String,
    pub masked_key: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

// ─── Stats ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStats {
    pub total_requests: u64,
    pub success_count: u64,
    pub error_count: u64,
    pub active_model_count: usize,
    pub last_request_at: Option<String>,
    pub uptime_ms: u64,
    pub local_base_url: String,
    pub server_running: bool,
}

// ─── Combined State (returned to frontend) ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeState {
    pub config: BridgeConfig,
    pub stats: BridgeStats,
    pub logs: Vec<RequestLogEntry>,
    pub client_keys: Vec<ClientApiKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub stats: BridgeStats,
    pub logs: Vec<RequestLogEntry>,
}

// ─── Input Types (Tauri command arguments) ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClientKeyInput {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClientKeyInput {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteClientKeyInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountInput {
    pub name: String,
    #[serde(default = "default_provider")]
    pub provider: AccountProvider,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_usage_tags")]
    pub usage_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountInput {
    pub id: String,
    pub name: String,
    #[serde(default = "default_provider")]
    pub provider: AccountProvider,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_usage_tags")]
    pub usage_tags: Vec<String>,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteAccountInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectAccountInput {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundTestInput {
    pub base_url: String,
    pub api_key: String,
    pub protocol: AccountProvider,
    pub model: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<i64>,
    #[serde(default)]
    pub stop_sequences: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    pub thinking_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_budget: Option<u32>,
    pub response_format: String,
    #[serde(default)]
    pub advanced_body: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundModelsInput {
    pub base_url: String,
    pub api_key: String,
    #[serde(default = "default_provider")]
    pub protocol: AccountProvider,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundTestResult {
    pub ok: bool,
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundModelsResult {
    pub ok: bool,
    pub status: u16,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detected_protocol: Option<AccountProvider>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResetUsageInput {
    pub confirm: bool,
}

// ─── Default config ──────────────────────────────────────────────────────────

/// Default upstream for `openai-compatible` accounts.
pub const DEFAULT_UPSTREAM_BASE_URL: &str = "https://api.bluesminds.com";
pub const DEFAULT_LOCAL_PORT: u16 = 48231;
impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            upstream_base_url: DEFAULT_UPSTREAM_BASE_URL.into(),
            api_key: String::new(),
            models: Vec::new(),
            selected_model: String::new(),
            local_port: DEFAULT_LOCAL_PORT,
            enable_cors: false,
            system_prompt: String::new(),
            active_account_id: String::new(),
            accounts: Vec::new(),
        }
    }
}
