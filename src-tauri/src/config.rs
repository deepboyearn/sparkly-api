// src-tauri/src/config.rs
// Configuration persistence and normalization — Rust port of src/main/configStore.ts.

use std::fs::{self, File};
use std::io::Write;
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

/// Create the file with owner-only permissions from the start, so the window
/// where a fresh key file is world-readable never exists.
fn create_private(path: &Path) -> Result<File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .with_context(|| format!("creating {}", path.display()))
}

fn write_all_synced(path: &Path, content: &[u8]) -> Result<()> {
    let mut file = create_private(path)?;
    file.write_all(content)
        .with_context(|| format!("writing {}", path.display()))?;
    // Durability before the rename: a crash must never publish a half-written
    // file under the real name.
    file.sync_all()
        .with_context(|| format!("fsync {}", path.display()))
}

/// Replace `path` atomically. The caller serializes first, so a serialization
/// failure never reaches this function and the existing file stays intact.
#[cfg(not(target_os = "windows"))]
fn replace_file(temp_path: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(temp_path, path)
}

#[cfg(target_os = "windows")]
fn replace_file(temp_path: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    if !path.exists() {
        return fs::rename(temp_path, path);
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }

    let wide = |value: &Path| {
        value
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>()
    };
    let replaced = wide(path);
    let replacement = wide(temp_path);
    let result = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir).with_context(|| format!("creating dir {}", dir.display()))?;

    // The temp file MUST live in the target's own directory: `rename` is only
    // atomic within one filesystem, and a temp dir is frequently a separate one.
    let stem = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("config");
    let temp_path = dir.join(format!(".{stem}.{}.tmp", Uuid::new_v4()));

    let result = write_all_synced(&temp_path, content).and_then(|()| {
        replace_file(&temp_path, path)
            .with_context(|| format!("replacing {} with {}", path.display(), temp_path.display()))
    });

    if result.is_err() {
        // Do not litter the data dir with orphaned temp files.
        let _ = fs::remove_file(&temp_path);
    }

    result
}

// ─── Masking ─────────────────────────────────────────────────────────────────

/// Mirrors `maskClientKey` (src/main/configStore.ts:135-137): first 9 chars,
/// 18 bullets, last 6 chars. Char-based so a non-ASCII key cannot panic on a
/// byte-slice boundary.
fn mask_client_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    let tail_start = chars.len().saturating_sub(6);
    let mut masked = String::with_capacity(key.len() + 18 * 3);
    masked.extend(chars.iter().take(9));
    for _ in 0..18 {
        masked.push('•');
    }
    masked.extend(&chars[tail_start..]);
    masked
}

// ─── Provider normalization ──────────────────────────────────────────────────

fn normalize_provider(provider: &AccountProvider) -> AccountProvider {
    provider.clone()
}

fn default_base_url_for_provider(provider: &AccountProvider) -> &'static str {
    match provider {
        AccountProvider::V0 => V0_BASE_URL,
        AccountProvider::Anthropic => "https://api.anthropic.com",
        AccountProvider::Gemini => "https://generativelanguage.googleapis.com/v1beta",
        AccountProvider::Ollama => "http://localhost:11434",
        AccountProvider::Cohere => "https://api.cohere.com",
        AccountProvider::Auto | AccountProvider::OpenaiCompatible => DEFAULT_UPSTREAM_BASE_URL,
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
                        AccountProvider::Anthropic => "Anthropic".to_string(),
                        AccountProvider::Gemini => "Gemini".to_string(),
                        AccountProvider::Ollama => "Ollama".to_string(),
                        AccountProvider::Cohere => "Cohere".to_string(),
                        AccountProvider::Auto | AccountProvider::OpenaiCompatible => {
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
            let is_active =
                account.id == active_account_id || (active_account_id.is_empty() && index == 0);

            UpstreamAccount {
                id,
                name,
                provider,
                detected_protocol: account.detected_protocol.clone(),
                base_url,
                api_key,
                usage_tags: vec!["coding".into()],
                is_active,
                last_used_at: account.last_used_at.clone(),
                models: normalize_models(account.models.clone()),
                selected_model: account.selected_model.trim().to_string(),
                models_last_refreshed_at: account.models_last_refreshed_at.clone(),
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
    let mut default = BridgeConfig::default();

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

    // A stored config may predate multi-account support (top-level apiKey, no
    // accounts) or have been written by a build whose default shipped an empty
    // accounts array. Either way there is no account to derive credentials
    // from, and `normalize_config` derives apiKey/upstreamBaseUrl FROM the
    // active account (configStore.ts:182-183) — so we keep the default
    // placeholder instead of letting the empty stored list overwrite it, and
    // seed any legacy top-level credential into it. That is what the JS
    // `normalizeAccounts` fallbackApiKey/fallbackBaseUrl params were for.
    let stored_accounts_present = parsed
        .get("accounts")
        .and_then(|v| v.as_array())
        .is_some_and(|list| !list.is_empty());
    if !stored_accounts_present {
        let legacy_api_key = parsed
            .get("apiKey")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .trim();
        if !legacy_api_key.is_empty() {
            let legacy_base_url = parsed
                .get("upstreamBaseUrl")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .trim()
                .trim_end_matches('/');
            if let Some(placeholder) = default.accounts.first_mut() {
                placeholder.api_key = legacy_api_key.to_string();
                if !legacy_base_url.is_empty() {
                    placeholder.base_url = legacy_base_url.to_string();
                }
            }
        }
    }

    // Shallow merge: start from default, overlay parsed keys.
    // Matches TS: { ...defaultConfig, ...parsed }
    let mut default_value = serde_json::to_value(&default).expect("default config serializes");
    if let (Some(default_obj), Some(parsed_obj)) =
        (default_value.as_object_mut(), parsed.as_object())
    {
        for (key, value) in parsed_obj {
            if !stored_accounts_present && matches!(key.as_str(), "accounts" | "activeAccountId") {
                continue;
            }
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
    let json = serde_json::to_string_pretty(config).context("serializing BridgeConfig")?;
    atomic_write(&config_path(data_dir), json.as_bytes())
}

pub fn persist_client_keys(keys: &[ClientApiKey], data_dir: &Path) -> Result<()> {
    let json = serde_json::to_string_pretty(keys).context("serializing client keys")?;
    atomic_write(&client_keys_path(data_dir), json.as_bytes())
}

/// Normalize then persist, returning the stored form — the Rust equivalent of
/// `saveConfig` (src/main/configStore.ts:158-162). Every mutating command goes
/// through this so what the frontend receives is byte-identical to what landed
/// on disk.
pub fn save_config(config: &mut BridgeConfig, data_dir: &Path) -> Result<()> {
    *config = normalize_config(std::mem::take(config));
    persist_config(config, data_dir)
}

// ─── Public: normalize ───────────────────────────────────────────────────────

fn normalize_models(models: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::with_capacity(models.len());
    models
        .into_iter()
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty() && seen.insert(model.clone()))
        .collect()
}

pub fn normalize_config(config: BridgeConfig) -> BridgeConfig {
    // Catalogs are provider data. Preserve exact ordering and identifiers; do
    // not inject application defaults or remove legitimate model names.
    let legacy_models = normalize_models(config.models);

    // Normalize accounts and resolve activeAccountId.
    let mut accounts = normalize_accounts(&config.accounts, &config.active_account_id);
    let active_account_id = accounts
        .iter()
        .find(|a| a.id == config.active_account_id)
        .map(|a| a.id.clone())
        .or_else(|| accounts.first().map(|a| a.id.clone()))
        .unwrap_or_default();

    // Migrate the former top-level catalog into the active account once. A
    // successful provider scan subsequently replaces the account catalog exactly.
    let active_index = accounts
        .iter()
        .position(|account| account.id == active_account_id)
        .or_else(|| (!accounts.is_empty()).then_some(0));
    if let Some(active) = active_index.and_then(|index| accounts.get_mut(index)) {
        if active.models.is_empty() && !legacy_models.is_empty() {
            active.models = legacy_models;
        }
        if active
            .models
            .iter()
            .any(|model| model == &config.selected_model)
        {
            active.selected_model = config.selected_model.trim().to_string();
        }
        if !active
            .models
            .iter()
            .any(|model| model == &active.selected_model)
        {
            active.selected_model = active.models.first().cloned().unwrap_or_default();
        }
    }

    let active_account = accounts
        .iter()
        .find(|account| account.id == active_account_id)
        .or_else(|| accounts.first());
    let models = active_account
        .map(|account| account.models.clone())
        .unwrap_or_default();
    let selected_model = active_account
        .map(|account| account.selected_model.clone())
        .unwrap_or_default();

    let local_port = DEFAULT_LOCAL_PORT;

    // Derive upstreamBaseUrl and apiKey from the active account.
    let upstream_base_url = active_account
        .map(|a| a.base_url.clone())
        .unwrap_or_else(|| {
            config
                .upstream_base_url
                .trim()
                .trim_end_matches('/')
                .to_string()
        });
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
                AccountProvider::Anthropic => "Anthropic".to_string(),
                AccountProvider::Gemini => "Gemini".to_string(),
                AccountProvider::Ollama => "Ollama".to_string(),
                AccountProvider::Cohere => "Cohere".to_string(),
                AccountProvider::Auto | AccountProvider::OpenaiCompatible => {
                    format!("Account {}", config.accounts.len() + 1)
                }
            }
        } else {
            trimmed.to_string()
        }
    };
    let base_url = {
        let trimmed = input.base_url.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            trimmed.to_string()
        } else {
            match provider {
                AccountProvider::V0 => V0_BASE_URL.to_string(),
                // JS falls back to the current top-level upstream, which
                // normalize_config keeps in sync with the active account.
                AccountProvider::Auto | AccountProvider::OpenaiCompatible => {
                    let current = config.upstream_base_url.trim().trim_end_matches('/');
                    if current.is_empty() {
                        DEFAULT_UPSTREAM_BASE_URL.to_string()
                    } else {
                        current.to_string()
                    }
                }
                AccountProvider::Anthropic
                | AccountProvider::Gemini
                | AccountProvider::Ollama
                | AccountProvider::Cohere => default_base_url_for_provider(&provider).to_string(),
            }
        }
    };
    let api_key = input.api_key.trim().to_string();

    // JS uses `accounts.length === 0`, which predates the default placeholder
    // account. That placeholder is a real row with no credentials, so keeping
    // it active would make normalize_config derive an empty top-level apiKey
    // and every /v1 request would 400 even after a real account exists.
    // Activate the newcomer when it is the first one carrying a key.
    let is_active = config.accounts.is_empty()
        || (!api_key.is_empty() && !config.accounts.iter().any(|a| !a.api_key.is_empty()));

    let id = Uuid::new_v4().to_string();
    if is_active {
        for account in &mut config.accounts {
            account.is_active = false;
        }
    }

    let models = if provider == AccountProvider::V0 {
        V0_MODELS.iter().map(|model| (*model).to_string()).collect()
    } else {
        Vec::new()
    };
    let selected_model = if provider == AccountProvider::V0 {
        V0_MODELS[0].into()
    } else {
        String::new()
    };
    config.accounts.push(UpstreamAccount {
        id: id.clone(),
        name,
        provider,
        detected_protocol: if provider == AccountProvider::Auto {
            None
        } else {
            Some(provider)
        },
        base_url,
        api_key,
        usage_tags: vec!["coding".into()],
        is_active,
        last_used_at: None,
        models,
        selected_model,
        models_last_refreshed_at: None,
    });

    if is_active || config.active_account_id.is_empty() {
        config.active_account_id = id;
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
        let provider_changed = account.provider != provider;
        let previous_url = account.base_url.clone();
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

        if provider_changed || account.base_url != previous_url {
            account.detected_protocol = if provider == AccountProvider::Auto {
                None
            } else {
                Some(provider)
            };
            account.models = if provider == AccountProvider::V0 {
                V0_MODELS.iter().map(|model| (*model).to_string()).collect()
            } else {
                Vec::new()
            };
            account.selected_model = account.models.first().cloned().unwrap_or_default();
            account.models_last_refreshed_at = None;
        }
        account.usage_tags = vec!["coding".into()];
        account.is_active = input.is_active;
    }

    if input.is_active {
        config.active_account_id = input.id.clone();
    } else if config.active_account_id == input.id {
        // INTENTIONAL DIVERGENCE from JS (src/main/configStore.ts:274), which
        // does `activeAccountId = input.isActive ? input.id : config.activeAccountId`
        // and therefore keeps pointing at the account it just deactivated —
        // `isActive: false` never sticks, because normalizeAccounts re-derives
        // isActive from activeAccountId. Promote another account so the
        // deactivation is coherent.
        match config.accounts.iter().position(|a| a.id != input.id) {
            Some(index) => {
                config.accounts[index].is_active = true;
                config.active_account_id = config.accounts[index].id.clone();
            }
            None => {
                // Sole account: there is nothing to promote and a config with
                // no active account cannot serve traffic, so keep it active.
                if let Some(only) = config.accounts.first_mut() {
                    only.is_active = true;
                }
            }
        }
    }
}

/// Remove an account. Mirrors `deleteAccount` (src/main/configStore.ts:278-283):
/// the active id re-points to whichever account still claims `isActive`, else
/// the first remaining one, else empty.
pub fn delete_account(config: &mut BridgeConfig, account_id: &str) {
    let was_active = config.active_account_id == account_id;
    config.accounts.retain(|a| a.id != account_id);

    if was_active
        || !config
            .accounts
            .iter()
            .any(|a| a.id == config.active_account_id)
    {
        config.active_account_id = config
            .accounts
            .iter()
            .find(|a| a.is_active)
            .or_else(|| config.accounts.first())
            .map(|a| a.id.clone())
            .unwrap_or_default();
    }

    // Keep the flags consistent with the id we just resolved, so the UI never
    // renders two active rows after a delete.
    let active_id = config.active_account_id.clone();
    for account in &mut config.accounts {
        account.is_active = account.id == active_id;
    }
}

/// Mirrors `selectActiveAccount` (src/main/configStore.ts:285-291): the target
/// becomes the only active account. An unknown id falls back to the first
/// account, which is what `normalizeConfig` does for the JS caller.
pub fn select_account(config: &mut BridgeConfig, account_id: &str) {
    let resolved = if config.accounts.iter().any(|a| a.id == account_id) {
        account_id.to_string()
    } else {
        config
            .accounts
            .first()
            .map(|a| a.id.clone())
            .unwrap_or_default()
    };

    for account in &mut config.accounts {
        account.is_active = account.id == resolved;
    }
    config.active_account_id = resolved.clone();
    if let Some(account) = config
        .accounts
        .iter()
        .find(|account| account.id == resolved)
    {
        config.models = account.models.clone();
        config.selected_model = account.selected_model.clone();
    }
}

/// The account requests are forwarded to: `activeAccountId` if it resolves,
/// otherwise the first account (same fallback as configStore.ts:174).
pub fn get_active_account(config: &BridgeConfig) -> Option<&UpstreamAccount> {
    config
        .accounts
        .iter()
        .find(|a| a.id == config.active_account_id)
        .or_else(|| config.accounts.first())
}

// ─── Public: client-key CRUD ─────────────────────────────────────────────────

/// Mint a client key and prepend it. Mirrors `createClientKey`
/// (src/main/configStore.ts:320-337): newest first, list capped at
/// `MAX_CLIENT_KEYS` by dropping the OLDEST entries (the tail).
pub fn create_client_key<'a>(keys: &'a mut Vec<ClientApiKey>, name: &str) -> &'a ClientApiKey {
    let clean_name = {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            format!("Key {}", keys.len() + 1)
        } else {
            trimmed.to_string()
        }
    };

    // `sk-` + 32 random bytes as lowercase hex, matching
    // `sk-${randomBytes(32).toString("hex")}`.
    let raw_key = {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill(&mut bytes);
        let mut s = String::with_capacity(3 + bytes.len() * 2);
        s.push_str("sk-");
        for b in bytes {
            s.push(HEX[(b >> 4) as usize] as char);
            s.push(HEX[(b & 0x0f) as usize] as char);
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
    keys.truncate(MAX_CLIENT_KEYS);

    // Safety: the key we just inserted is at index 0, and MAX_CLIENT_KEYS > 0.
    &keys[0]
}

pub fn update_client_key(keys: &mut [ClientApiKey], id: &str, name: &str) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("sparkly-config-test-{}", Uuid::new_v4()))
    }

    #[test]
    fn normalization_enforces_the_permanent_local_port() {
        let mut config = BridgeConfig::default();
        config.local_port = 65_000;
        assert_eq!(normalize_config(config).local_port, DEFAULT_LOCAL_PORT);
    }

    fn account(id: &str, models: &[&str], selected_model: &str) -> UpstreamAccount {
        UpstreamAccount {
            id: id.into(),
            name: id.into(),
            provider: AccountProvider::OpenaiCompatible,
            detected_protocol: Some(AccountProvider::OpenaiCompatible),
            base_url: format!("https://{id}.example/v1"),
            api_key: format!("key-{id}"),
            usage_tags: vec!["coding".into()],
            is_active: false,
            last_used_at: None,
            models: models.iter().map(|model| (*model).to_string()).collect(),
            selected_model: selected_model.into(),
            models_last_refreshed_at: None,
        }
    }

    #[test]
    fn provider_catalog_is_preserved_exactly_without_default_injection_or_filtering() {
        let mut config = BridgeConfig::default();
        config.active_account_id = "router".into();
        config.accounts = vec![account(
            "router",
            &["provider/codex", " model-b ", "provider/codex"],
            "provider/codex",
        )];

        let normalized = normalize_config(config);
        assert_eq!(normalized.models, vec!["provider/codex", "model-b"]);
        assert_eq!(normalized.selected_model, "provider/codex");
    }

    #[test]
    fn selecting_an_account_switches_its_catalog_and_credentials() {
        let mut config = BridgeConfig::default();
        config.active_account_id = "first".into();
        config.accounts = vec![
            account("first", &["first-model"], "first-model"),
            account("second", &["second-model"], "second-model"),
        ];

        select_account(&mut config, "second");
        let normalized = normalize_config(config);
        assert_eq!(normalized.active_account_id, "second");
        assert_eq!(normalized.models, vec!["second-model"]);
        assert_eq!(normalized.selected_model, "second-model");
        assert_eq!(normalized.api_key, "key-second");
    }

    #[test]
    fn persistence_replaces_an_existing_config() {
        let dir = test_dir();
        let mut first = BridgeConfig::default();
        first.selected_model = "first-model".into();
        persist_config(&first, &dir).expect("first write");

        let mut second = first;
        second.selected_model = "second-model".into();
        persist_config(&second, &dir).expect("replacement write");

        let stored = fs::read_to_string(config_path(&dir)).expect("read stored config");
        assert!(stored.contains("second-model"));
        assert!(!stored.contains("first-model"));
        let _ = fs::remove_dir_all(dir);
    }
}
