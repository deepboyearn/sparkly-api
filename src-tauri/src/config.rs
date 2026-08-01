// src-tauri/src/config.rs
// Configuration persistence and normalization — Rust port of src/main/configStore.ts.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use chrono::Utc;
use rand::Rng;
use uuid::Uuid;

use crate::types::*;

// ─── Constants ───────────────────────────────────────────────────────────────

const CONFIG_FILENAME: &str = "bridge-config.json";
const CLIENT_KEYS_FILENAME: &str = "client-keys.json";
const MAX_CLIENT_KEYS: usize = 10;

// ─── Path helpers ────────────────────────────────────────────────────────────

fn config_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join(CONFIG_FILENAME)
}

fn client_keys_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join(CLIENT_KEYS_FILENAME)
}

// ─── Atomic write (temp + rename, chmod 0o600 on POSIX) ──────────────────────

#[cfg(unix)]
fn set_restrictive_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .with_context(|| format!("chmod 0o600 on {}", path.display()))
}

#[cfg(not(unix))]
fn set_restrictive_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir).with_context(|| format!("creating dir {}", dir.display()))?;

    let temp_name = format!(".tmp.{}", Uuid::new_v4());
    let temp_path = dir.join(&temp_name);

    fs::write(&temp_path, content)
        .with_context(|| format!("writing temp file {}", temp_path.display()))?;

    set_restrictive_permissions(&temp_path)?;

    fs::rename(&temp_path, path)
        .with_context(|| format!("renaming {} → {}", temp_path.display(), path.display()))?;

    Ok(())
}

// ─── Masking ─────────────────────────────────────────────────────────────────

fn mask_client_key(key: &str) -> String {
    if key.len() < 16 {
        return "•".repeat(33);
    }
    let suffix_start = key.len() - 6;
    format!("{}{}{}", &key[..9], "•".repeat(18), &key[suffix_start..])
}

// ─── Provider normalization ──────────────────────────────────────────────────

fn normalize_provider(provider: &AccountProvider) -> AccountProvider {
    match provider {
        AccountProvider::V0 => AccountProvider::V0,
        AccountProvider::OpenaiCompatible => AccountProvider::OpenaiCompatible,
    }
}

fn default_base_url_for_provider(provider: &AccountProvider) -> &str {
    match provider {
        AccountProvider::V0 => V0_BASE_URL,
        AccountProvider::OpenaiCompatible => "https://api.bluesminds.com",
    }
}

// ─── Account normalization ───────────────────────────────────────────────────

fn normalize_accounts(
    accounts: &[UpstreamAccount],
    active_account_id: &str,
) -> Vec<UpstreamAccount> {
    if accounts.is_empty() {
        return Vec::new();
    }

    let mut normalized: Vec<UpstreamAccount> = accounts
        .iter()
        .enumerate()
        .map(|(index, account)| {
            let provider = normalize_provider(&account.provider);
            let id = if account.id.is_empty() {
                Uuid::new_v4().to_string()
            } else {
                account.id.clone()
            };
            let name = {
                let trimmed = account.name.trim();
                if trimmed.is_empty() {
                    match provider {
                        AccountProvider::V0 => "v0".to_string(),
                        AccountProvider::OpenaiCompatible => {
                            format!("Account {}", index + 1)
                        }
                    }
                } else {
                    trimmed.to_string()
                }
            };
            let base_url = {
                let trimmed = account.base_url.trim().trim_end_matches('/');
                if trimmed.is_empty() {
                    default_base_url_for_provider(&provider).to_string()
                } else {
                    trimmed.to_string()
                }
            };
            let api_key = account.api_key.trim().to_string();
            let is_active = account.id == active_account_id
                || (active_account_id.is_empty() && index == 0);

            UpstreamAccount {
                id,
                name,
                provider,
                base_url,
                api_key,
                usage_tags: vec!["coding".into()],
                is_active,
                last_used_at: account.last_used_at.clone(),
            }
        })
        .collect();

    // Ensure at least one account is active.
    if !normalized.iter().any(|a| a.is_active) {
        if let Some(first) = normalized.first_mut() {
            first.is_active = true;
        }
    }

    normalized
}

// ─── Public: load ────────────────────────────────────────────────────────────

pub fn load_config(data_dir: &Path) -> BridgeConfig {
    let path = config_path(data_dir);
    let default = BridgeConfig::default();

    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // First run — create file with defaults
            let _ = persist_config(&default, data_dir);
            return default;
        }
        Err(e) => {
            tracing::warn!("Failed to read {}: {e}", path.display());
            return default;
        }
    };

    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Corrupt JSON in {}: {e}", path.display());
            return default;
        }
    };

    // Shallow merge: start from default, overlay parsed keys.
    // Matches TS: { ...defaultConfig, ...parsed }
    let mut default_value = serde_json::to_value(&default).expect("default config serializes");
    if let (Some(default_obj), Some(parsed_obj)) =
        (default_value.as_object_mut(), parsed.as_object())
    {
        for (key, value) in parsed_obj {
            default_obj.insert(key.clone(), value.clone());
        }
    }

    match serde_json::from_value::<BridgeConfig>(default_value) {
        Ok(config) => Some(normalize_config(config)),
        Err(e) => {
            tracing::warn!("Failed to deserialize merged config: {e}");
            None
        }
    }
    .unwrap_or(default)
}

pub fn load_client_keys(data_dir: &Path) -> Vec<ClientApiKey> {
    let path = client_keys_path(data_dir);

    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // First run — create file with empty array
            let _ = persist_client_keys(&Vec::new(), data_dir);
            return Vec::new();
        }
        Err(e) => {
            tracing::warn!("Failed to read {}: {e}", path.display());
            return Vec::new();
        }
    };

    // A successful `Vec<ClientApiKey>` parse already implies a JSON array.
    match serde_json::from_str::<Vec<ClientApiKey>>(&raw) {
        Ok(keys) => keys,
        Err(e) => {
            tracing::warn!("Corrupt JSON in {}: {e}", path.display());
            Vec::new()
        }
    }
}

// ─── Public: persist ─────────────────────────────────────────────────────────

pub fn persist_config(config: &BridgeConfig, data_dir: &Path) -> Result<()> {
    let json = serde_json::to_string_pretty(config)
        .context("serializing BridgeConfig")?;
    atomic_write(&config_path(data_dir), json.as_bytes())
}

pub fn persist_client_keys(keys: &[ClientApiKey], data_dir: &Path) -> Result<()> {
    let json = serde_json::to_string_pretty(keys)
        .context("serializing client keys")?;
    atomic_write(&client_keys_path(data_dir), json.as_bytes())
}

// ─── Public: normalize ───────────────────────────────────────────────────────

pub fn normalize_config(config: BridgeConfig) -> BridgeConfig {
    // Merge default models with input models, trim, dedup, filter codex.
    let default_models = BridgeConfig::default().models;
    let mut seen = std::collections::HashSet::new();
    let mut models: Vec<String> = Vec::new();

    for model in default_models.into_iter().chain(config.models.into_iter()) {
        let trimmed = model.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower.contains("codex") {
            continue;
        }
        if seen.insert(lower) {
            models.push(trimmed);
        }
    }

    // Normalize accounts and resolve activeAccountId.
    let accounts = normalize_accounts(&config.accounts, &config.active_account_id);
    let active_account_id = accounts
        .iter()
        .find(|a| a.id == config.active_account_id)
        .map(|a| a.id.clone())
        .or_else(|| accounts.first().map(|a| a.id.clone()))
        .unwrap_or_default();

    let active_account = accounts
        .iter()
        .find(|a| a.id == active_account_id)
        .or_else(|| accounts.first());

    // Derive selectedModel.
    let default_selected = BridgeConfig::default().selected_model;
    let selected_model = if models.iter().any(|m| m == &config.selected_model) {
        config.selected_model
    } else if models.iter().any(|m| m == &default_selected) {
        default_selected
    } else {
        models.first().cloned().unwrap_or_default()
    };

    // Clamp port to 10000..=65535.
    let local_port: u16 = config.local_port.clamp(10000, 65535);

    // Derive upstreamBaseUrl and apiKey from the active account.
    let upstream_base_url = active_account
        .map(|a| a.base_url.clone())
        .unwrap_or_else(|| config.upstream_base_url.trim().trim_end_matches('/').to_string());
    let api_key = active_account
        .map(|a| a.api_key.clone())
        .unwrap_or_else(|| config.api_key.trim().to_string());

    BridgeConfig {
        upstream_base_url,
        api_key,
        models,
        selected_model,
        local_port,
        enable_cors: config.enable_cors,
        system_prompt: config.system_prompt.trim().to_string(),
        accounts,
        active_account_id,
    }
}

// ─── Public: account CRUD ────────────────────────────────────────────────────

pub fn create_account(config: &mut BridgeConfig, input: &CreateAccountInput) {
    let provider = normalize_provider(&input.provider);
    let name = {
        let trimmed = input.name.trim();
        if trimmed.is_empty() {
            match provider {
                AccountProvider::V0 => "v0".to_string(),
                AccountProvider::OpenaiCompatible => {
                    format!("Account {}", config.accounts.len() + 1)
                }
            }
        } else {
            trimmed.to_string()
        }
    };
    let base_url = {
        let trimmed = input.base_url.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            default_base_url_for_provider(&provider).to_string()
        } else {
            trimmed.to_string()
        }
    };
    let is_active = config.accounts.is_empty();

    let next_account = UpstreamAccount {
        id: Uuid::new_v4().to_string(),
        name,
        provider,
        base_url,
        api_key: input.api_key.trim().to_string(),
        usage_tags: vec!["coding".into()],
        is_active,
        last_used_at: None,
    };

    config.accounts.push(next_account.clone());

    // Ensure activeAccountId is set.
    if config.active_account_id.is_empty() {
        config.active_account_id = next_account.id;
    }
}

pub fn update_account(config: &mut BridgeConfig, input: &UpdateAccountInput) {
    let provider = normalize_provider(&input.provider);

    for account in &mut config.accounts {
        if account.id != input.id {
            // If the updated account becomes active, deactivate others.
            if input.is_active {
                account.is_active = false;
            }
            continue;
        }

        let trimmed_name = input.name.trim();
        if !trimmed_name.is_empty() {
            account.name = trimmed_name.to_string();
        }
        account.provider = provider.clone();

        let trimmed_url = input.base_url.trim().trim_end_matches('/');
        if !trimmed_url.is_empty() {
            account.base_url = trimmed_url.to_string();
        } else {
            account.base_url = default_base_url_for_provider(&provider).to_string();
        }

        let trimmed_key = input.api_key.trim();
        if !trimmed_key.is_empty() {
            account.api_key = trimmed_key.to_string();
        }

        account.usage_tags = vec!["coding".into()];
        account.is_active = input.is_active;
    }

    if input.is_active {
        config.active_account_id = input.id.clone();
    }
}

pub fn delete_account(config: &mut BridgeConfig, account_id: &str) {
    config.accounts.retain(|a| a.id != account_id);

    // Re-resolve activeAccountId.
    config.active_account_id = config
        .accounts
        .iter()
        .find(|a| a.is_active)
        .map(|a| a.id.clone())
        .or_else(|| config.accounts.first().map(|a| a.id.clone()))
        .unwrap_or_default();
}

pub fn select_account(config: &mut BridgeConfig, account_id: &str) {
    for account in &mut config.accounts {
        account.is_active = account.id == account_id;
    }
    config.active_account_id = account_id.to_string();
}

pub fn get_active_account(config: &BridgeConfig) -> Option<&UpstreamAccount> {
    config
        .accounts
        .iter()
        .find(|a| a.id == config.active_account_id)
}

// ─── Public: client-key CRUD ─────────────────────────────────────────────────

pub fn create_client_key<'a>(keys: &'a mut Vec<ClientApiKey>, name: &str) -> &'a ClientApiKey {
    let clean_name = {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            format!("Key {}", keys.len() + 1)
        } else {
            trimmed.to_string()
        }
    };

    let raw_key = {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill(&mut bytes);
        let mut s = String::with_capacity(67); // "sk-" + 64 hex chars
        s.push_str("sk-");
        for b in &bytes {
            s.push_str(&format!("{b:02x}"));
        }
        s
    };

    let key = ClientApiKey {
        id: Uuid::new_v4().to_string(),
        name: clean_name,
        masked_key: mask_client_key(&raw_key),
        key: raw_key,
        created_at: Utc::now().to_rfc3339(),
        last_used_at: None,
        is_active: true,
    };

    keys.insert(0, key);

    // Cap at MAX_CLIENT_KEYS.
    if keys.len() > MAX_CLIENT_KEYS {
        keys.truncate(MAX_CLIENT_KEYS);
    }

    // Safety: we just pushed, so index 0 always exists.
    &keys[0]
}

pub fn update_client_key(keys: &mut Vec<ClientApiKey>, id: &str, name: &str) {
    let trimmed = name.trim();
    if let Some(key) = keys.iter_mut().find(|k| k.id == id) {
        if !trimmed.is_empty() {
            key.name = trimmed.to_string();
        }
    }
}

pub fn delete_client_key(keys: &mut Vec<ClientApiKey>, id: &str) {
    keys.retain(|k| k.id != id);
}
