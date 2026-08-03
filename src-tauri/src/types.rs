// src-tauri/src/types.rs
// Shared type definitions — Rust equivalents of shared/types.ts
// All agents implement against these types.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
    #[serde(default = "default_local_port", deserialize_with = "deserialize_local_port")]
    pub local_port: u16,
    #[serde(default = "default_true")]
    pub enable_cors: bool,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub accounts: Vec<UpstreamAccount>,
    #[serde(default)]
    pub active_account_id: String,
}

fn default_true() -> bool { true }

/// Accepted range for the local listener port; mirrors the clamp in
/// `normalizeConfig` (src/main/configStore.ts:186).
pub const MIN_LOCAL_PORT: u16 = 10_000;
pub const MAX_LOCAL_PORT: u16 = 65_535;

fn default_local_port() -> u16 { DEFAULT_LOCAL_PORT }

/// The settings UI posts whatever `Number(input.value)` produced, so a stored
/// `localPort` can be out of `u16` range, negative, or `null`. JS clamps such
/// values; a plain `u16` field would instead fail deserialization and take the
/// entire config down to defaults, so clamp here and let `normalize_config`
/// agree with the result.
fn deserialize_local_port<'de, D>(deserializer: D) -> Result<u16, D::Error>
where
    D: serde::Deserializer<'de>,
{
    match Option::<f64>::deserialize(deserializer)? {
        Some(value) if value.is_finite() => Ok((value as i64)
            .clamp(MIN_LOCAL_PORT as i64, MAX_LOCAL_PORT as i64) as u16),
        _ => Ok(DEFAULT_LOCAL_PORT),
    }
}

// ─── Upstream Accounts ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamAccount {
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
}

fn default_provider() -> AccountProvider { AccountProvider::OpenaiCompatible }
fn default_usage_tags() -> Vec<String> { vec!["coding".into()] }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AccountProvider {
    #[serde(rename = "openai-compatible")]
    OpenaiCompatible,
    #[serde(rename = "v0")]
    V0,
    #[serde(rename = "anthropic")]
    Anthropic,
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

// ─── Input Types (Tauri command arguments) ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClientKeyInput { pub name: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClientKeyInput { pub id: String, pub name: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteClientKeyInput { pub id: String }

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
pub struct DeleteAccountInput { pub id: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectAccountInput { pub id: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundTestInput {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundModelsInput {
    pub base_url: String,
    pub api_key: String,
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
    pub raw: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResetUsageInput { pub confirm: bool }

// ─── Default config ──────────────────────────────────────────────────────────

/// Default upstream for `openai-compatible` accounts.
pub const DEFAULT_UPSTREAM_BASE_URL: &str = "https://api.bluesminds.com";
pub const DEFAULT_LOCAL_PORT: u16 = 48231;
pub const DEFAULT_SELECTED_MODEL: &str = "gpt-5.4";

/// Model catalog seeded into every config; mirrors `defaultConfig.models`
/// in src/main/configStore.ts.
pub const DEFAULT_MODELS: &[&str] = &[
    "gpt-5",
    "gpt-5.1",
    "gpt-5.2",
    "gpt-5.4",
    "gpt-5.4-mini",
    "claude-haiku-4-5-20251001",
    "claude-haiku-4-5-20251001-thinking",
    "claude-opus-4-5",
    "claude-opus-4-6",
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-5-20250929-thinking",
    "claude-sonnet-4-6",
    "deepseek-chat",
    "deepseek-chat-search",
    "deepseek-expert-chat",
    "deepseek-expert-chat-search",
    "deepseek-expert-reasoner",
    "deepseek-expert-reasoner-search",
    "deepseek-reasoner",
    "deepseek-reasoner-search",
    "glm-4.7",
    "glm-5",
    "grok-4.20-0309",
    "grok-4.20-0309-non-reasoning",
    "grok-4.20-0309-reasoning",
    "grok-imagine-image-lite",
    "MiniMax-M2.5",
    "moonshotai/kimi-k2.5",
    "qwen/qwen3.6-plus",
    "qwen3.5-omni-plus",
    "qwen3.5-omni-plus-search",
    "qwen3.5-omni-plus-thinking",
    "qwen3.5-omni-plus-thinking-search",
    "qwen3.5-plus",
    "qwen3.5-plus-search",
    "qwen3.5-plus-thinking",
    "qwen3.5-plus-thinking-search",
    "qwen3.6-plus",
    "qwen3.6-plus-image-edit",
    "qwen3.6-plus-search",
    "qwen3.6-plus-thinking",
    "qwen3.6-plus-thinking-search",
];

impl Default for BridgeConfig {
    fn default() -> Self {
        // One placeholder account, exactly like `defaultConfig` in configStore.ts:
        // without it `has_configured_upstream` fails and the UI has no row to edit.
        let account = UpstreamAccount {
            id: Uuid::new_v4().to_string(),
            name: "Primary Account".into(),
            provider: AccountProvider::OpenaiCompatible,
            base_url: DEFAULT_UPSTREAM_BASE_URL.into(),
            api_key: String::new(),
            usage_tags: vec!["coding".into()],
            is_active: true,
            last_used_at: None,
        };

        Self {
            upstream_base_url: DEFAULT_UPSTREAM_BASE_URL.into(),
            api_key: String::new(),
            models: DEFAULT_MODELS.iter().map(|m| (*m).to_string()).collect(),
            selected_model: DEFAULT_SELECTED_MODEL.into(),
            local_port: DEFAULT_LOCAL_PORT,
            enable_cors: true,
            system_prompt: String::new(),
            active_account_id: account.id.clone(),
            accounts: vec![account],
        }
    }
}
