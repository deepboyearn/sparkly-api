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
        fs::rename(&temp_path, path)
            .with_context(|| format!("renaming {} → {}", temp_path.display(), path.display()))
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
    match provider {
        AccountProvider::V0 => AccountProvider::V0,
        AccountProvider::OpenaiCompatible => AccountProvider::OpenaiCompatible,
    }
}

fn default_base_url_for_provider(provider: &AccountProvider) -> &'static str {
    match provider {
        AccountProvider::V0 => V0_BASE_URL,
        AccountProvider::OpenaiCompatible => DEFAULT_UPSTREAM_BASE_URL,
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
    let json = serde_json::to_string_pretty(config)
        .context("serializing BridgeConfig")?;
    atomic_write(&config_path(data_dir), json.as_bytes())
}

pub fn persist_client_keys(keys: &[ClientApiKey], data_dir: &Path) -> Result<()> {
    let json = serde_json::to_string_pretty(keys)
        .context("serializing client keys")?;
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

pub fn normalize_config(config: BridgeConfig) -> BridgeConfig {
    // Seed the catalog with the defaults, then append the caller's models,
    // trimming, dropping blanks and anything matching /codex/i, and deduping.
    // JS dedups with a `Set` of the trimmed strings, so the comparison is
    // case-SENSITIVE while the codex filter is case-insensitive.
    let mut seen: std::collections::HashSet<String> =
        std::collections::HashSet::with_capacity(DEFAULT_MODELS.len() + config.models.len());
    let mut models: Vec<String> = Vec::with_capacity(seen.capacity());

    for model in DEFAULT_MODELS
        .iter()
        .map(|m| (*m).to_string())
        .chain(config.models.into_iter())
    {
        let trimmed = model.trim();
        if trimmed.is_empty() || trimmed.to_ascii_lowercase().contains("codex") {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            models.push(trimmed.to_string());
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

    // Derive selectedModel: keep the caller's choice when it survived the
    // filter, else the default, else the first model.
    let selected_model = if models.iter().any(|m| m == &config.selected_model) {
        config.selected_model
    } else if models.iter().any(|m| m == DEFAULT_SELECTED_MODEL) {
        DEFAULT_SELECTED_MODEL.to_string()
    } else {
        models.first().cloned().unwrap_or_default()
    };

    let local_port = config.local_port.clamp(MIN_LOCAL_PORT, MAX_LOCAL_PORT);

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
        if !trimmed.is_empty() {
            trimmed.to_string()
        } else {
            match provider {
                AccountProvider::V0 => V0_BASE_URL.to_string(),
                // JS falls back to the current top-level upstream, which
                // normalize_config keeps in sync with the active account.
                AccountProvider::OpenaiCompatible => {
                    let current = config.upstream_base_url.trim().trim_end_matches('/');
                    if current.is_empty() {
                        DEFAULT_UPSTREAM_BASE_URL.to_string()
                    } else {
                        current.to_string()
                    }
                }
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

    config.accounts.push(UpstreamAccount {
        id: id.clone(),
        name,
        provider,
        base_url,
        api_key,
        usage_tags: vec!["coding".into()],
        is_active,
        last_used_at: None,
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

    if was_active || !config.accounts.iter().any(|a| a.id == config.active_account_id) {
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
    config.active_account_id = resolved;
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
