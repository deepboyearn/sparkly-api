// src-tauri/src/bridge.rs
// Axum HTTP bridge server — forwards OpenAI-compatible requests to upstream accounts.
// Port of bridgeServer.ts with failover, agent loop, and Responses API translation.

use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};

use axum::extract::rejection::JsonRejection;
use axum::extract::{DefaultBodyLimit, Json, State as AxumState};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use chrono::Utc;
use reqwest::Client;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, RwLock};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use crate::types::*;
use crate::AppState;

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_LOGS: usize = 200;
const MAX_AGENT_TURNS: usize = 5;
const UPSTREAM_TIMEOUT_SECS: u64 = 120;
const PLAYGROUND_TIMEOUT_SECS: u64 = 30;
const AUTHORITATIVE_MODEL_FETCH_TIMEOUT_SECS: u64 = 20;
const FALLBACK_MODEL_FETCH_TIMEOUT_SECS: u64 = 8;
const RESPONSES_SESSION_LIMIT: usize = 50;

// ─── Module-level singletons ────────────────────────────────────────────────

static SHUTDOWN_TX: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);
static SERVER_GENERATION: AtomicU64 = AtomicU64::new(0);
static SERVER_STOPPING: AtomicBool = AtomicBool::new(false);
static UPSTREAM_ROUTE_CACHE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Conversation items for `/v1/responses`, keyed by response id.
static SESSIONS: LazyLock<RwLock<ResponsesSessions>> =
    LazyLock::new(|| RwLock::new(ResponsesSessions::default()));

/// Shared client for every upstream call.
///
/// Building a `Client` per request throws away the connection pool and repeats
/// TLS setup on each proxied call, which is the hot path of this whole process.
/// Redirects follow reqwest's default policy to match the JS `fetch`, which
/// followed them; reqwest strips `Authorization` on a cross-host hop.
static UPSTREAM_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .timeout(std::time::Duration::from_secs(UPSTREAM_TIMEOUT_SECS))
        .build()
        .expect("building the shared upstream HTTP client")
});

/// Insertion-ordered store of `/v1/responses` conversation items.
///
/// A bare `HashMap` cannot express the eviction rule the JS relies on —
/// `sessions.keys().next()` drops the *oldest* entry of an insertion-ordered
/// `Map` (bridgeServer.ts:988-993), whereas `HashMap` iteration order is
/// randomised and could evict the newest conversation instead.
#[derive(Default)]
struct ResponsesSessions {
    items: HashMap<String, Vec<Value>>,
    order: VecDeque<String>,
}

impl ResponsesSessions {
    fn get(&self, id: &str) -> Option<&Vec<Value>> {
        self.items.get(id)
    }

    fn insert(&mut self, id: String, items: Vec<Value>) {
        if self.items.insert(id.clone(), items).is_none() {
            self.order.push_back(id);
        }
        while self.order.len() > RESPONSES_SESSION_LIMIT {
            match self.order.pop_front() {
                Some(oldest) => {
                    self.items.remove(&oldest);
                }
                None => break,
            }
        }
    }
}

/// Flatten a chat/Responses `content` value to plain text.
///
/// Port of `stringifyToolMessageContent` (bridgeServer.ts:1159-1194): strings
/// pass through, arrays contribute their `text`/`content` parts joined by
/// newlines, anything else falls back to its JSON encoding.
fn stringify_content(content: &Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }

    if let Some(arr) = content.as_array() {
        let text = arr
            .iter()
            .filter_map(|part| {
                let obj = part.as_object()?;
                obj.get("text")
                    .or_else(|| obj.get("content"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
            })
            .collect::<Vec<_>>()
            .join("\n");

        if !text.is_empty() {
            return text;
        }
    }

    if content.is_null() {
        return String::new();
    }

    content.to_string()
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Extract `<title>` from an HTML string for error summarization.
fn extract_html_title(html: &str) -> String {
    let lower = html.to_lowercase();
    if let Some(start) = lower.find("<title>") {
        let rest = &html[start + 7..];
        if let Some(end) = rest.find("</title>") {
            return rest[..end].trim().to_string();
        }
    }
    String::new()
}

/// Summarize a failed playground/model-fetch response into a human-readable error.
fn summarize_playground_failure(status: u16, raw: &Value, text: &str) -> String {
    if let Some(msg) = raw.pointer("/error/message").and_then(|v| v.as_str()) {
        return msg.to_string();
    }
    let title = extract_html_title(text);
    if !title.is_empty() {
        return title;
    }
    format!("HTTP {status} request failed")
}

/// Extract model IDs from common provider catalog shapes.
///
/// OpenAI-compatible servers return `{data:[{id}]}`. Provider routers such as
/// 9router expose `{models:[{alias,fullModel,model}]}` from `/api/models`.
fn extract_models_from_response(raw: &Value) -> Vec<String> {
    let items = raw
        .as_array()
        .or_else(|| raw.get("data").and_then(Value::as_array))
        .or_else(|| raw.get("models").and_then(Value::as_array));

    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .flatten()
        .filter_map(|item| {
            if let Some(model) = item.as_str() {
                return Some(model);
            }
            item.get("id")
                // Routers may expose aliases, while Gemini, Cohere, and Ollama
                // use `name` or `model`. Persist the exact routable identifier.
                .or_else(|| item.get("fullModel"))
                .or_else(|| item.get("name"))
                .or_else(|| item.get("model"))
                .or_else(|| item.get("alias"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(String::from)
        .filter(|model| seen.insert(model.clone()))
        .collect()
}

/// Normalize a base URL by stripping trailing slashes and a terminal API
/// version. A custom prefix such as `/openai/v1` remains `/openai`.
fn normalize_base_url(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed
        .strip_suffix("/v1")
        .unwrap_or(trimmed)
        .trim_end_matches('/')
        .to_string()
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !value.is_empty() && !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

/// Derive bounded route candidates from a user-supplied provider URL.
fn upstream_url_candidates(base_url: &str, path: &str) -> Vec<String> {
    let supplied = base_url.trim().trim_end_matches('/');
    let suffix = path.strip_prefix("/v1").unwrap_or(path);
    let mut candidates = Vec::new();

    if supplied.ends_with("/v1") || supplied.ends_with("/api/v1") {
        push_unique(&mut candidates, format!("{supplied}{suffix}"));
    } else {
        push_unique(&mut candidates, format!("{supplied}{path}"));
    }
    push_unique(
        &mut candidates,
        format!("{}{}", normalize_base_url(supplied), path),
    );

    if let Ok(mut origin) = reqwest::Url::parse(supplied) {
        origin.set_path("");
        origin.set_query(None);
        origin.set_fragment(None);
        let root = origin.as_str().trim_end_matches('/');
        push_unique(&mut candidates, format!("{root}{path}"));
        push_unique(&mut candidates, format!("{root}/api{path}"));
    }

    candidates
}

fn upstream_url(base_url: &str, path: &str) -> String {
    upstream_url_candidates(base_url, path)
        .into_iter()
        .next()
        .unwrap_or_default()
}

fn route_cache_key(base_url: &str, path: &str) -> String {
    format!("{}|{path}", base_url.trim().trim_end_matches('/'))
}

fn route_is_missing(status: u16, body: &Value) -> bool {
    if status == 405 {
        return true;
    }
    if status != 404 {
        return false;
    }
    let code = body
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or("");
    if matches!(code, "model_not_found" | "authentication_error") {
        return false;
    }
    let message = body
        .pointer("/error/message")
        .or_else(|| body.get("detail"))
        .and_then(Value::as_str)
        .unwrap_or_else(|| body.as_str().unwrap_or(""))
        .to_ascii_lowercase();
    message.is_empty()
        || message.contains("not found")
        || message.contains("cannot get")
        || message.contains("cannot post")
        || message.contains("no route")
        || message.contains("<!doctype html")
}

/// Check whether the config has at least one configured upstream account.
fn has_configured_upstream(config: &BridgeConfig) -> bool {
    !config.api_key.is_empty()
        || config.accounts.iter().any(|account| {
            let protocol = if account.provider == AccountProvider::Auto {
                account.detected_protocol.unwrap_or(AccountProvider::Auto)
            } else {
                account.provider
            };
            !account.base_url.is_empty()
                && (protocol == AccountProvider::Ollama || !account.api_key.is_empty())
        })
}

/// Determine whether we should failover to the next account for this status/body.
///
/// Mirrors `shouldFailoverAccount` (bridgeServer.ts:1518-1546): hard auth/quota
/// and 5xx statuses always failover; a 400 only does when the error payload
/// smells like a billing problem. `code`/`type` are only matched against
/// quota/insufficient — the wider vocabulary applies to `message` alone.
fn should_failover(status: u16, body: &Value) -> bool {
    if matches!(status, 401 | 402 | 403 | 429 | 500 | 502 | 503 | 504) {
        return true;
    }

    if status != 400 {
        return false;
    }

    let Some(err) = body.get("error") else {
        return false;
    };
    let field = |key: &str| {
        err.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase()
    };
    let code = field("code");
    let typ = field("type");
    let message = field("message");

    code.contains("quota")
        || code.contains("insufficient")
        || typ.contains("quota")
        || typ.contains("insufficient")
        || message.contains("quota")
        || message.contains("insufficient")
        || message.contains("credit")
        || message.contains("balance")
        || message.contains("billing")
        || message.contains("rate limit")
}

/// Wrap JSON body parsing in the Anthropic error envelope.
///
/// Mirrors `json_body_or_error` but returns the Anthropic error shape:
/// `{"type":"error","error":{"type":"...","message":"..."}}`
/// instead of the OpenAI shape, so Claude SDK clients can parse it.
fn anthropic_json_body_or_error(
    body: Result<Json<Value>, JsonRejection>,
) -> Result<Value, Response> {
    match body {
        Ok(Json(value)) => Ok(value),
        Err(JsonRejection::MissingJsonContentType(_)) => Ok(json!({})),
        Err(JsonRejection::JsonSyntaxError(e)) => Err(anthropic_error_response(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            &format!("Invalid JSON in request body: {e}"),
        )),
        Err(JsonRejection::JsonDataError(e)) => Err(anthropic_error_response(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            &format!("Invalid request body: {e}"),
        )),
        Err(rejection) => Err(anthropic_error_response(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            &format!("Could not read request body: {rejection}"),
        )),
    }
}

/// Construct a standard JSON error response.
fn json_error(status: StatusCode, message: &str, error_type: &str) -> Response {
    (
        status,
        Json(json!({
            "error": {
                "message": message,
                "type": error_type,
            }
        })),
    )
        .into_response()
}

/// Extract a JSON request body, mirroring `express.json()`'s tolerance while
/// still failing in the OpenAI error shape.
///
/// - absent body / no `Content-Type` → `{}` (express leaves `req.body`
///   undefined and the JS handlers fall back to `{}`)
/// - malformed JSON → `Err` carrying a `{error:{message,type}}` response
///
/// axum's own rejection is `text/plain`, which an OpenAI-compatible client
/// cannot parse.
fn json_body_or_error(body: Result<Json<Value>, JsonRejection>) -> Result<Value, Response> {
    match body {
        Ok(Json(value)) => Ok(value),
        Err(JsonRejection::MissingJsonContentType(_)) => Ok(json!({})),
        Err(JsonRejection::JsonSyntaxError(e)) => Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Invalid JSON in request body: {e}"),
            "bridge_request_error",
        )),
        Err(JsonRejection::JsonDataError(e)) => Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Invalid request body: {e}"),
            "bridge_request_error",
        )),
        Err(rejection) => Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("Could not read request body: {rejection}"),
            "bridge_request_error",
        )),
    }
}

/// Get the active upstream account from config (active_account_id or first).
///
/// Falls back to the first account when `activeAccountId` is empty *or* dangling,
/// matching `getActiveAccount` (bridgeServer.ts:1514-1516).
fn get_active_account(config: &BridgeConfig) -> Option<&UpstreamAccount> {
    config
        .accounts
        .iter()
        .find(|a| a.id == config.active_account_id)
        .or_else(|| config.accounts.first())
}

/// Extract the model name from a JSON request body.
fn extract_model(body: &Value) -> Option<String> {
    body.get("model").and_then(|v| v.as_str()).map(String::from)
}

/// JavaScript `Boolean(value)` for a JSON value: everything except `undefined`,
/// `null`, `false`, `0`, and `""` is truthy.
fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// Apply model defaults: inject selected_model if missing, prepend system prompt.
///
/// Port of `applyModelDefaults` (bridgeServer.ts:289-310).
fn apply_model_defaults(body: &mut Value, config: &BridgeConfig) {
    let has_model = body
        .get("model")
        .and_then(|v| v.as_str())
        .map(|m| !m.is_empty())
        .unwrap_or(false);
    if !has_model {
        body["model"] = Value::String(config.selected_model.clone());
    }

    if config.system_prompt.is_empty() {
        return;
    }

    // A missing or non-array `messages` becomes a fresh array holding just the
    // system prompt — the JS builds `[]` and then unshifts into it.
    let messages = match body.get_mut("messages").and_then(|v| v.as_array_mut()) {
        Some(existing) => existing,
        None => {
            body["messages"] = json!([{"role": "system", "content": config.system_prompt}]);
            return;
        }
    };

    let has_system = messages
        .iter()
        .any(|m| m.get("role").and_then(|v| v.as_str()) == Some("system"));
    if !has_system {
        messages.insert(
            0,
            json!({"role": "system", "content": config.system_prompt}),
        );
    }
}

/// Push a request log entry (newest first, capped at [`MAX_LOGS`]).
///
/// The JS unshifts into `logs` (bridgeServer.ts:1570-1577) and derives
/// `lastRequestAt` from `logs[0].timestamp`, so `BridgeStats.last_request_at`
/// is computed by the readers rather than cached here.
async fn record_log(
    logs: &RwLock<Vec<RequestLogEntry>>,
    method: &str,
    path: &str,
    status: u16,
    model: Option<String>,
    duration_ms: u64,
    error: Option<String>,
) {
    let mut l = logs.write().await;
    l.insert(
        0,
        RequestLogEntry {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            method: method.to_string(),
            path: path.to_string(),
            status,
            model,
            duration_ms,
            error,
        },
    );
    l.truncate(MAX_LOGS);
}

/// Count one *completed* request. Failover retries are logged but not counted,
/// matching the JS totals which only move on the returned outcome
/// (bridgeServer.ts:1268-1303).
async fn count_request(stats: &RwLock<BridgeStats>, success: bool) {
    let mut s = stats.write().await;
    s.total_requests += 1;
    if success {
        s.success_count += 1;
    } else {
        s.error_count += 1;
    }
}

/// Mark an account as used, promote it to active, and persist both changes.
///
/// The JS original rewrote the entire config file inline on every successful
/// request (`markAccountUsed`, configStore.ts:294-297), putting a synchronous
/// disk write on the hot path. Here the in-memory state is updated under the
/// lock and the file write is handed to a blocking task, so `lastUsedAt` still
/// survives a restart without delaying the proxied response.
async fn mark_account_used(state: &AppState, account_id: &str) {
    let snapshot = {
        let mut cfg = state.config.write().await;
        let mut changed = false;

        if let Some(account) = cfg.accounts.iter_mut().find(|a| a.id == account_id) {
            account.last_used_at = Some(Utc::now().to_rfc3339());
            changed = true;
        }

        if cfg.active_account_id != account_id {
            // `selectActiveAccount` moves the isActive flag with the id.
            for account in &mut cfg.accounts {
                account.is_active = account.id == account_id;
            }
            cfg.active_account_id = account_id.to_string();
            changed = true;
        }

        if changed {
            Some(cfg.clone())
        } else {
            None
        }
    };

    let Some(config) = snapshot else {
        return;
    };
    let data_dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || {
        if let Err(error) = crate::config::persist_config(&config, &data_dir) {
            tracing::warn!("Failed to persist account usage: {error}");
        }
    });
}

// ─── Tool helpers for agent loop ────────────────────────────────────────────
//
// Classification and execution live in `crate::tools`; this module only
// adapts that API to the `(Value, bool)` shape the agent loop consumes.

use crate::tools::{is_file_tool_name, is_shell_tool_name};

/// Execute a tool call locally. Returns (result_json, is_fatal).
///
/// Gated on the `tool-execution` feature: without it, model-emitted tool calls
/// are refused instead of running commands or touching files on the host.
async fn execute_tool_call(tool_name: &str, raw_arguments: &str) -> (Value, bool) {
    if !is_shell_tool_name(tool_name) && !is_file_tool_name(tool_name) {
        return (
            json!({
                "ok": false,
                "error": format!("Unknown tool: {tool_name}"),
                "code": "UNKNOWN_TOOL",
                "retryable": false,
            }),
            false,
        );
    }

    #[cfg(not(feature = "tool-execution"))]
    {
        let _ = raw_arguments;
        (
            json!({
                "ok": false,
                "error": "Local tool execution is disabled in this build.",
                "code": "TOOL_NOT_AVAILABLE",
                "retryable": false,
            }),
            false,
        )
    }

    #[cfg(feature = "tool-execution")]
    {
        let root = crate::tools::workspace_root();
        let root = root.to_string_lossy();

        let result = if is_shell_tool_name(tool_name) {
            let command = crate::tools::extract_shell_command(raw_arguments);
            crate::tools::execute_shell_command(&command, &root).await
        } else {
            let parsed: Value = serde_json::from_str(raw_arguments).unwrap_or_else(|_| json!({}));
            crate::tools::execute_file_tool(tool_name, &parsed, &root).await
        };

        // `content` is a JSON document produced by the tool layer; surface it
        // verbatim when parseable so the model sees structured output.
        let value = serde_json::from_str(&result.content)
            .unwrap_or_else(|_| json!({ "ok": !result.is_fatal, "output": result.content }));

        (value, result.is_fatal)
    }
}

// ─── Responses ↔ Chat mapping ──────────────────────────────────────────────

/// Merge conversation input with previous response session items.
fn merge_conversation_input(body: &Value, sessions: &ResponsesSessions) -> Value {
    let prev_id = body
        .get("previous_response_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if prev_id.is_empty() {
        return body.get("input").cloned().unwrap_or_else(|| json!([]));
    }

    let previous_items = sessions.get(prev_id).cloned().unwrap_or_default();
    let current_items = body
        .get("input")
        .map(|input| {
            if let Some(arr) = input.as_array() {
                arr.clone()
            } else if let Some(s) = input.as_str() {
                vec![json!({"role": "user", "content": s})]
            } else {
                vec![]
            }
        })
        .unwrap_or_default();

    let mut merged = previous_items;
    merged.extend(current_items);
    Value::Array(merged)
}

/// Map a Responses-format input array to chat messages.
fn normalize_responses_input(input: &Value) -> Vec<Value> {
    if let Some(s) = input.as_str() {
        return vec![json!({"role": "user", "content": s})];
    }

    let arr = match input.as_array() {
        Some(a) => a,
        None => return vec![json!({"role": "user", "content": ""})],
    };

    let mut messages = Vec::new();

    for item in arr {
        // Plain string → user message
        if let Some(s) = item.as_str() {
            messages.push(json!({"role": "user", "content": s}));
            continue;
        }

        let obj = match item.as_object() {
            Some(o) => o,
            None => continue,
        };

        let typ = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let role = obj.get("role").and_then(|v| v.as_str()).unwrap_or("user");

        // function_call_output → tool message
        if typ == "function_call_output" {
            if let Some(call_id) = obj.get("call_id").and_then(|v| v.as_str()) {
                let output = obj
                    .get("output")
                    .map(|v| {
                        if v.is_string() {
                            v.as_str().unwrap().to_string()
                        } else {
                            v.to_string()
                        }
                    })
                    .unwrap_or_default();
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": output,
                }));
            }
            continue;
        }

        // function_call → assistant with tool_calls
        if typ == "function_call" {
            if let Some(call_id) = obj.get("call_id").and_then(|v| v.as_str()) {
                let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                messages.push(json!({
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": tool_arguments(obj.get("arguments")),
                        }
                    }],
                }));
            }
            continue;
        }

        // Standard role message (user/assistant/system). Content that is
        // neither a string nor an array carries nothing usable, and the JS
        // drops such items rather than sending an empty message
        // (bridgeServer.ts:399-405).
        if let Some(content) = map_responses_content_to_chat(obj.get("content")) {
            messages.push(json!({"role": role, "content": content}));
        }
    }

    if messages.is_empty() {
        vec![json!({"role": "user", "content": ""})]
    } else {
        messages
    }
}

/// Map a Responses content value to a chat-compatible content value.
///
/// `None` means "no usable content" and the enclosing item is dropped, matching
/// the `undefined` return of `mapResponsesContentToChatContent`.
fn map_responses_content_to_chat(content: Option<&Value>) -> Option<Value> {
    let content = content?;

    if let Some(s) = content.as_str() {
        return Some(Value::String(s.to_string()));
    }

    let arr = content.as_array()?;

    let mut parts = Vec::new();

    for part in arr {
        let obj = match part.as_object() {
            Some(o) => o,
            None => continue,
        };

        let typ = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");

        // Text parts
        if matches!(typ, "input_text" | "output_text" | "text") {
            if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
                parts.push(json!({"type": "text", "text": text}));
            }
            continue;
        }

        // Image parts
        if typ == "input_image" || typ == "image_url" {
            let url = obj
                .get("image_url")
                .map(|img| {
                    if let Some(s) = img.as_str() {
                        s.to_string()
                    } else if let Some(u) = img.get("url").and_then(|v| v.as_str()) {
                        u.to_string()
                    } else {
                        String::new()
                    }
                })
                .unwrap_or_default();

            if url.is_empty() {
                continue;
            }

            // `detail` may sit on the part or inside the `image_url` object.
            let detail = obj
                .get("detail")
                .or_else(|| obj.get("image_url").and_then(|img| img.get("detail")))
                .and_then(|v| v.as_str());
            if let Some(d) = detail {
                parts.push(json!({
                    "type": "image_url",
                    "image_url": {"url": url, "detail": d},
                }));
            } else {
                parts.push(json!({
                    "type": "image_url",
                    "image_url": {"url": url},
                }));
            }
            continue;
        }

        // File input → text placeholder
        if typ == "input_file" {
            let filename = obj
                .get("filename")
                .or_else(|| obj.get("file_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("attached-file");
            parts.push(json!({"type": "text", "text": format!("[input_file:{filename}]")}));
            continue;
        }

        // Fallback: any part with text or content field
        if let Some(text) = obj.get("text").and_then(|v| v.as_str()) {
            parts.push(json!({"type": "text", "text": text}));
        } else if let Some(c) = obj.get("content").and_then(|v| v.as_str()) {
            parts.push(json!({"type": "text", "text": c}));
        }
    }

    if parts.is_empty() {
        return Some(Value::String(String::new()));
    }

    // If all parts are plain text, flatten to a string
    let has_structured = parts
        .iter()
        .any(|p| p.get("type").and_then(|v| v.as_str()) != Some("text"));

    if has_structured {
        return Some(Value::Array(parts));
    }

    let combined = parts
        .iter()
        .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Some(Value::String(combined))
}

/// Normalize a tool-call `arguments` value to the JSON string chat expects.
///
/// A client may send the arguments as an object rather than an encoded string;
/// the JS stringified those (bridgeServer.ts:1222-1225) instead of discarding
/// them.
fn tool_arguments(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(other) if !other.is_null() => other.to_string(),
        _ => "{}".to_string(),
    }
}

/// Map Responses tools to chat tools format.
fn map_responses_tools_to_chat(tools: &Value) -> Vec<Value> {
    let arr = match tools.as_array() {
        Some(a) => a,
        None => return vec![],
    };

    arr.iter()
        .filter_map(|tool| {
            let obj = tool.as_object()?;
            if obj.get("type").and_then(|v| v.as_str()) != Some("function") {
                return None;
            }
            let name = obj.get("name").and_then(|v| v.as_str())?;
            let parameters = obj
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| json!({"type": "object", "properties": {}}));

            let mut function = json!({"name": name, "parameters": parameters});
            // A missing description is omitted, not sent as "" — some upstreams
            // reject an empty description, and `JSON.stringify` dropped the key.
            if let Some(description) = obj.get("description").and_then(|v| v.as_str()) {
                function["description"] = Value::String(description.to_string());
            }

            Some(json!({"type": "function", "function": function}))
        })
        .collect()
}

/// Map Responses tool_choice to chat tool_choice format.
fn map_responses_tool_choice(tool_choice: &Value, has_tools: bool) -> Value {
    if !has_tools {
        return Value::Null;
    }

    if let Some(s) = tool_choice.as_str() {
        if matches!(s, "auto" | "none" | "required") {
            return Value::String(s.to_string());
        }
    }

    if let Some(obj) = tool_choice.as_object() {
        if obj.get("type").and_then(|v| v.as_str()) == Some("function") {
            if let Some(name) = obj.get("name").and_then(|v| v.as_str()) {
                return json!({
                    "type": "function",
                    "function": {"name": name},
                });
            }
        }
    }

    Value::Null
}

/// Map a full Responses request to a chat completions request body.
fn map_responses_request_to_chat(
    body: &Value,
    config: &BridgeConfig,
    sessions: &ResponsesSessions,
) -> Value {
    let merged_input = merge_conversation_input(body, sessions);
    let messages = normalize_responses_input(&merged_input);
    let chat_tools = map_responses_tools_to_chat(body.get("tools").unwrap_or(&Value::Null));
    let has_tools = !chat_tools.is_empty();
    let tool_choice =
        map_responses_tool_choice(body.get("tool_choice").unwrap_or(&Value::Null), has_tools);

    let mut chat_body = json!({
        "model": body.get("model")
            .and_then(|v| v.as_str())
            .unwrap_or(&config.selected_model),
        "messages": messages,
    });

    if has_tools {
        chat_body["tools"] = Value::Array(chat_tools);
    }

    if !tool_choice.is_null() {
        chat_body["tool_choice"] = tool_choice;
    }

    // Only forward these when they carry the type the JS checked for; anything
    // else was `undefined` and therefore absent from the upstream body.
    if let Some(ptc) = body.get("parallel_tool_calls").filter(|v| v.is_boolean()) {
        chat_body["parallel_tool_calls"] = ptc.clone();
    }

    if let Some(max) = body.get("max_output_tokens").filter(|v| v.is_number()) {
        chat_body["max_tokens"] = max.clone();
    }

    if let Some(temp) = body.get("temperature").filter(|v| v.is_number()) {
        chat_body["temperature"] = temp.clone();
    }

    chat_body
}

/// Map a chat completion response to the Responses format.
fn map_chat_response_to_responses(
    body: &Value,
    request_body: &Value,
    fallback_model: Option<&str>,
) -> Value {
    let chat = if body.is_object() { body } else { &json!({}) };

    let assistant_message = chat
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("message"));

    let output_text = assistant_message
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    let model = chat
        .get("model")
        .and_then(|v| v.as_str())
        .or(fallback_model)
        .unwrap_or("");

    // `resp_${chat.id.replace(/^resp_/, "")}` — an id that already carries the
    // prefix is not doubled up. A blank id falls through to a fresh uuid.
    let response_id = chat
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|id| !id.is_empty())
        .map(|id| format!("resp_{}", id.strip_prefix("resp_").unwrap_or(id)))
        .unwrap_or_else(|| format!("resp_{}", Uuid::new_v4().as_simple()));

    let created_at = chat
        .get("created")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| Utc::now().timestamp() as u64);

    let input_tokens = chat
        .pointer("/usage/prompt_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let output_tokens = chat
        .pointer("/usage/completion_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let total_tokens = chat
        .pointer("/usage/total_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(input_tokens + output_tokens);

    // Tool calls the upstream asked for, surfaced as Responses output items.
    let tool_call_outputs = assistant_message
        .and_then(|m| m.get("tool_calls"))
        .and_then(|tc| tc.as_array())
        .map(|arr| {
            arr.iter().filter_map(|tc| {
                let id = tc.get("id").and_then(|v| v.as_str())?;
                let name = tc.pointer("/function/name").and_then(|n| n.as_str())?;
                Some(json!({
                    "id": id,
                    "type": "function_call",
                    "call_id": id,
                    "name": name,
                    "arguments": tool_arguments(tc.pointer("/function/arguments")),
                }))
            })
        });

    let mut output = vec![json!({
        "id": format!("msg_{}", Uuid::new_v4().as_simple()),
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{
            "type": "output_text",
            "text": output_text,
            "annotations": [],
        }],
    })];
    if let Some(items) = tool_call_outputs {
        output.extend(items);
    }

    let mut response = json!({
        "id": response_id,
        "object": "response",
        "created_at": created_at,
        "status": "completed",
        "model": model,
        "output": output,
        "output_text": output_text,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
        },
    });

    if let Some(temp) = request_body.get("temperature").filter(|v| v.is_number()) {
        response["temperature"] = temp.clone();
    }

    response
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Build the full editable state used at startup and after explicit mutations.
pub async fn build_bridge_state(state: &AppState) -> BridgeState {
    let config = state.config.read().await.clone();
    let client_keys = state.client_keys.read().await.clone();
    let runtime = build_runtime_snapshot(state).await;

    BridgeState {
        config,
        stats: runtime.stats,
        logs: runtime.logs,
        client_keys,
    }
}

/// Build the lightweight live-refresh payload. It deliberately excludes
/// configuration, provider credentials, account records, and client-key data.
pub async fn build_runtime_snapshot(state: &AppState) -> RuntimeSnapshot {
    let logs = state.logs.read().await.clone();
    let mut stats = state.stats.read().await.clone();
    stats.uptime_ms = state.started_at.elapsed().as_millis() as u64;
    stats.active_model_count = state.config.read().await.models.len();
    stats.last_request_at = logs.first().map(|entry| entry.timestamp.clone());
    RuntimeSnapshot { stats, logs }
}

#[derive(Clone)]
struct ModelCatalogProbe {
    protocol: AccountProvider,
    url: String,
}

fn model_catalog_probes(base_url: &str, requested: AccountProvider) -> Vec<ModelCatalogProbe> {
    let supplied = base_url.trim().trim_end_matches('/');
    let mut probes = Vec::new();
    let mut add = |protocol: AccountProvider, url: String| {
        if !url.is_empty()
            && !probes
                .iter()
                .any(|probe: &ModelCatalogProbe| probe.protocol == protocol && probe.url == url)
        {
            probes.push(ModelCatalogProbe { protocol, url });
        }
    };

    let protocols: Vec<AccountProvider> = if requested == AccountProvider::Auto {
        vec![
            AccountProvider::OpenaiCompatible,
            AccountProvider::Anthropic,
            AccountProvider::Gemini,
            AccountProvider::Ollama,
            AccountProvider::Cohere,
        ]
    } else {
        vec![requested]
    };

    for protocol in protocols {
        match protocol {
            AccountProvider::OpenaiCompatible => {
                for url in upstream_url_candidates(supplied, "/v1/models") {
                    add(protocol, url);
                }
                if let Ok(mut origin) = reqwest::Url::parse(supplied) {
                    origin.set_path("/api/models");
                    origin.set_query(None);
                    origin.set_fragment(None);
                    add(protocol, origin.to_string());
                }
            }
            AccountProvider::Anthropic => {
                for url in upstream_url_candidates(supplied, "/v1/models") {
                    add(protocol, url);
                }
            }
            AccountProvider::Gemini => {
                let root = supplied.trim_end_matches("/v1beta").trim_end_matches('/');
                add(protocol, format!("{root}/v1beta/models"));
            }
            AccountProvider::Ollama => {
                let root = supplied.trim_end_matches("/api").trim_end_matches('/');
                add(protocol, format!("{root}/api/tags"));
            }
            AccountProvider::Cohere => {
                add(protocol, upstream_url(supplied, "/v1/models"));
            }
            AccountProvider::V0 => {}
            AccountProvider::Auto => unreachable!(),
        }
    }
    probes
}

async fn fetch_model_catalog(
    base_url: &str,
    api_key: &str,
    requested: AccountProvider,
) -> Result<(u16, Value, Vec<String>, AccountProvider), String> {
    let probes = model_catalog_probes(base_url, requested);
    let mut failures = Vec::new();

    // The exact configured-protocol route is authoritative. Auto detection is
    // ordered and sequential; catalog GETs may fall back, generation never does.
    for (index, probe) in probes.into_iter().enumerate() {
        let timeout_secs = if index == 0 {
            AUTHORITATIVE_MODEL_FETCH_TIMEOUT_SECS
        } else {
            FALLBACK_MODEL_FETCH_TIMEOUT_SECS
        };
        let mut request = UPSTREAM_CLIENT
            .get(&probe.url)
            .timeout(std::time::Duration::from_secs(timeout_secs));
        request = match probe.protocol {
            AccountProvider::Anthropic => request
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01"),
            AccountProvider::Gemini => request.header("x-goog-api-key", api_key),
            AccountProvider::Ollama => request,
            _ => request
                .header("Authorization", format!("Bearer {api_key}"))
                .header("x-api-key", api_key),
        };
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                failures.push(format!("{}: {error}", probe.url));
                continue;
            }
        };
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        let raw = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text.clone()));
        let models = extract_models_from_response(&raw);
        if (200..300).contains(&status) && !models.is_empty() {
            return Ok((status, raw, models, probe.protocol));
        }
        failures.push(format!(
            "{}: {}",
            probe.url,
            summarize_playground_failure(status, &raw, &text),
        ));
    }
    Err(format!(
        "No usable model catalog found: {}",
        failures.join("; ")
    ))
}

/// Fetch models and the protocol that produced them for account persistence.
pub async fn fetch_models_from_provider(
    base_url: &str,
    api_key: &str,
    protocol: AccountProvider,
) -> Result<(Vec<String>, AccountProvider), String> {
    fetch_model_catalog(base_url, api_key, protocol)
        .await
        .map(|(_, _, models, detected)| (models, detected))
}

/// Fetch models for the playground UI without mutating account state.
pub async fn fetch_playground_models(
    base_url: &str,
    api_key: &str,
    protocol: AccountProvider,
) -> Result<PlaygroundModelsResult, String> {
    match fetch_model_catalog(base_url, api_key, protocol).await {
        Ok((status, raw, models, detected_protocol)) => Ok(PlaygroundModelsResult {
            ok: true,
            status,
            models,
            detected_protocol: Some(detected_protocol),
            raw: Some(raw),
            error: None,
        }),
        Err(error) => Ok(PlaygroundModelsResult {
            ok: false,
            status: 502,
            models: vec![],
            detected_protocol: None,
            raw: None,
            error: Some(error),
        }),
    }
}

/// Run a protocol-aware Playground request. Catalog discovery may probe safe
/// GET routes, but this function sends exactly one generation request.
pub async fn playground_test(input: PlaygroundTestInput) -> Result<PlaygroundTestResult, String> {
    if input.max_tokens == 0 {
        return Err("maxTokens must be greater than zero.".into());
    }
    if input.thinking_mode == "enabled" {
        let budget = input.thinking_budget.unwrap_or(0);
        if budget < 1024 || budget >= input.max_tokens {
            return Err(
                "Manual thinking requires thinkingBudget >= 1024 and less than maxTokens.".into(),
            );
        }
    }

    let mut messages = Vec::new();
    if let Some(system) = input
        .system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        messages.push(json!({"role": "system", "content": system}));
    }
    messages.push(json!({"role": "user", "content": input.message}));

    let mut body = match input.protocol {
        AccountProvider::Anthropic => {
            let mut value = json!({
                "model": input.model,
                "max_tokens": input.max_tokens,
                "messages": [{"role": "user", "content": input.message}],
            });
            if let Some(system) = input
                .system_prompt
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                value["system"] = Value::String(system.to_string());
            }
            match input.thinking_mode.as_str() {
                "disabled" => value["thinking"] = json!({"type": "disabled"}),
                "adaptive" => value["thinking"] = json!({"type": "adaptive"}),
                "enabled" => {
                    value["thinking"] =
                        json!({"type": "enabled", "budget_tokens": input.thinking_budget})
                }
                _ => {}
            }
            if let Some(effort) = &input.reasoning_effort {
                value["output_config"] = json!({"effort": effort});
            }
            if input.response_format == "json_object" {
                value["output_config"]["format"] =
                    json!({"type": "json_schema", "schema": {"type": "object"}});
            }
            value
        }
        AccountProvider::Gemini => {
            let contents: Vec<Value> = messages
                .iter()
                .filter(|message| message["role"] != "system")
                .map(|message| {
                    json!({
                        "role": "user",
                        "parts": [{"text": message["content"]}],
                    })
                })
                .collect();
            let mut value = json!({"contents": contents, "generationConfig": {"maxOutputTokens": input.max_tokens}});
            if let Some(system) = input
                .system_prompt
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                value["systemInstruction"] = json!({"parts": [{"text": system}]});
            }
            if input.response_format == "json_object" {
                value["generationConfig"]["responseMimeType"] =
                    Value::String("application/json".into());
            }
            value
        }
        AccountProvider::Ollama => json!({
            "model": input.model,
            "messages": messages,
            "stream": false,
            "options": {"num_predict": input.max_tokens},
            "format": if input.response_format == "json_object" { Value::String("json".into()) } else { Value::Null },
        }),
        AccountProvider::Cohere => json!({
            "model": input.model,
            "messages": messages,
            "stream": false,
            "max_tokens": input.max_tokens,
            "response_format": if input.response_format == "json_object" { json!({"type": "json_object"}) } else { Value::Null },
        }),
        AccountProvider::OpenaiCompatible => {
            let mut value = json!({"model": input.model, "messages": messages, "max_completion_tokens": input.max_tokens});
            if let Some(effort) = &input.reasoning_effort {
                value["reasoning_effort"] = Value::String(effort.clone());
            }
            if input.response_format == "json_object" {
                value["response_format"] = json!({"type": "json_object"});
            }
            value
        }
        AccountProvider::Auto | AccountProvider::V0 => {
            return Err("Select a resolved Playground protocol before generation.".into());
        }
    };

    if let Some(temperature) = input.temperature {
        if input.protocol == AccountProvider::Anthropic && !(0.0..=1.0).contains(&temperature) {
            return Err("Anthropic temperature must be between 0 and 1.".into());
        }
        match input.protocol {
            AccountProvider::Gemini => body["generationConfig"]["temperature"] = json!(temperature),
            AccountProvider::Ollama => body["options"]["temperature"] = json!(temperature),
            _ => body["temperature"] = json!(temperature),
        }
    }
    if let Some(top_p) = input.top_p {
        match input.protocol {
            AccountProvider::Gemini => body["generationConfig"]["topP"] = json!(top_p),
            AccountProvider::Ollama => body["options"]["top_p"] = json!(top_p),
            _ => body["top_p"] = json!(top_p),
        }
    }
    if let Some(seed) = input.seed {
        match input.protocol {
            AccountProvider::Gemini => body["generationConfig"]["seed"] = json!(seed),
            AccountProvider::Ollama => body["options"]["seed"] = json!(seed),
            AccountProvider::Anthropic => {}
            _ => body["seed"] = json!(seed),
        }
    }
    if !input.stop_sequences.is_empty() {
        match input.protocol {
            AccountProvider::Anthropic | AccountProvider::Cohere => {
                body["stop_sequences"] = json!(&input.stop_sequences)
            }
            AccountProvider::Gemini => {
                body["generationConfig"]["stopSequences"] = json!(&input.stop_sequences)
            }
            AccountProvider::Ollama => body["options"]["stop"] = json!(&input.stop_sequences),
            _ => body["stop"] = json!(&input.stop_sequences),
        }
    }
    if let Some(object) = body.as_object_mut() {
        for (key, value) in input.advanced_body {
            object.insert(key, value);
        }
    }

    let supplied = input.base_url.trim().trim_end_matches('/');
    let url = match input.protocol {
        AccountProvider::Anthropic => upstream_url(supplied, "/v1/messages"),
        AccountProvider::Gemini => {
            let root = supplied.trim_end_matches("/v1beta");
            format!(
                "{root}/v1beta/models/{}:generateContent",
                input.model.trim_start_matches("models/")
            )
        }
        AccountProvider::Ollama => format!("{supplied}/api/chat"),
        AccountProvider::Cohere => format!("{supplied}/v2/chat"),
        AccountProvider::OpenaiCompatible => upstream_url(supplied, "/v1/chat/completions"),
        AccountProvider::Auto | AccountProvider::V0 => unreachable!(),
    };

    let mut request = UPSTREAM_CLIENT
        .post(&url)
        .header("content-type", "application/json");
    request = match input.protocol {
        AccountProvider::Anthropic => request
            .header("x-api-key", &input.api_key)
            .header("anthropic-version", "2023-06-01"),
        AccountProvider::Gemini => request.header("x-goog-api-key", &input.api_key),
        AccountProvider::Ollama => request,
        _ => request.header("Authorization", format!("Bearer {}", input.api_key)),
    };
    let response = request
        .timeout(std::time::Duration::from_secs(PLAYGROUND_TIMEOUT_SECS))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Playground request failed at {url}: {error}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let raw = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text.clone()));
    let ok = (200..300).contains(&status);
    let content = match input.protocol {
        AccountProvider::Anthropic => raw.get("content").and_then(Value::as_array).map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        }),
        AccountProvider::Gemini => raw
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(Value::as_str)
            .map(String::from),
        AccountProvider::Ollama | AccountProvider::Cohere => {
            raw.pointer("/message/content").and_then(|value| {
                value.as_str().map(String::from).or_else(|| {
                    value.as_array().map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.get("text").and_then(Value::as_str))
                            .collect::<Vec<_>>()
                            .join("")
                    })
                })
            })
        }
        _ => raw
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(String::from),
    };
    let error = if ok {
        None
    } else {
        Some(summarize_playground_failure(status, &raw, &text))
    };
    Ok(PlaygroundTestResult {
        ok,
        status,
        model: Some(input.model),
        content,
        raw: Some(raw),
        request: Some(body),
        resolved_url: Some(url),
        error,
    })
}

// ─── Upstream forwarding with failover ──────────────────────────────────────

/// Forward a request through the failover chain.
/// Returns (status, content_type, body).
async fn forward_request(
    state: &AppState,
    incoming_path: &str,
    upstream_path: &str,
    method: &str,
    body: Option<&Value>,
) -> (u16, String, Value) {
    let config = state.config.read().await.clone();
    let started = std::time::Instant::now();

    // Ordered candidate list: active account first, then the rest. Accounts
    // without credentials can never succeed, so they are dropped up front —
    // that also keeps `is_last` honest, otherwise a genuine failure on the
    // second-to-last account would fall through to the generic "no accounts"
    // error and the real upstream status would be lost.
    let accounts: Vec<&UpstreamAccount> = {
        let usable = |a: &&UpstreamAccount| {
            let protocol = if a.provider == AccountProvider::Auto {
                a.detected_protocol.unwrap_or(AccountProvider::Auto)
            } else {
                a.provider
            };
            !a.base_url.is_empty() && (protocol == AccountProvider::Ollama || !a.api_key.is_empty())
        };
        match get_active_account(&config) {
            Some(active) => std::iter::once(active)
                .chain(config.accounts.iter().filter(|a| a.id != active.id))
                .filter(usable)
                .collect(),
            None => config.accounts.iter().filter(usable).collect(),
        }
    };

    let model = body.and_then(extract_model);
    let last_index = accounts.len().saturating_sub(1);

    for (index, account) in accounts.iter().enumerate() {
        let is_last = index == last_index;

        let protocol = if account.provider == AccountProvider::Auto {
            account.detected_protocol.unwrap_or(AccountProvider::Auto)
        } else {
            account.provider
        };
        let result = match protocol {
            AccountProvider::V0 => forward_v0_request(account, upstream_path, method, body).await,
            AccountProvider::Anthropic => {
                forward_anthropic_upstream(account, upstream_path, method, body).await
            }
            AccountProvider::OpenaiCompatible => {
                forward_openai_compatible_request(account, upstream_path, method, body).await
            }
            AccountProvider::Gemini | AccountProvider::Ollama | AccountProvider::Cohere => {
                forward_native_chat_upstream(account, protocol, upstream_path, method, body).await
            }
            AccountProvider::Auto => Ok((
                400,
                "application/json".into(),
                json!({"error": {"message": "Auto protocol is unresolved. Sync this account's model catalog before generation.", "type": "bridge_protocol_error"}}),
            )),
        };

        match result {
            Ok((status, ct, resp_body)) => {
                let duration = started.elapsed().as_millis() as u64;
                let is_success = (200..300).contains(&status);

                record_log(
                    &state.logs,
                    method,
                    incoming_path,
                    status,
                    model.clone(),
                    duration,
                    None,
                )
                .await;

                if is_success {
                    count_request(&state.stats, true).await;
                    mark_account_used(state, &account.id).await;
                    return (status, ct, resp_body);
                }

                if !should_failover(status, &resp_body) || is_last {
                    count_request(&state.stats, false).await;
                    return (status, ct, resp_body);
                }
                // Otherwise fall through and try the next account.
            }
            Err(e) => {
                if !is_last {
                    continue;
                }

                let duration = started.elapsed().as_millis() as u64;
                record_log(
                    &state.logs,
                    method,
                    incoming_path,
                    502,
                    model.clone(),
                    duration,
                    Some(e.clone()),
                )
                .await;
                count_request(&state.stats, false).await;

                return (
                    502,
                    "application/json".into(),
                    json!({"error": {"message": e, "type": "bridge_upstream_error"}}),
                );
            }
        }
    }

    (
        400,
        "application/json".into(),
        json!({"error": {"message": "No configured upstream accounts are available.", "type": "bridge_account_error"}}),
    )
}

/// Forward to an OpenAI-compatible provider with bounded route detection.
async fn forward_openai_compatible_request(
    account: &UpstreamAccount,
    upstream_path: &str,
    method: &str,
    body: Option<&Value>,
) -> Result<(u16, String, Value), String> {
    let cache_key = route_cache_key(&account.base_url, upstream_path);
    let cached = UPSTREAM_ROUTE_CACHE.lock().get(&cache_key).cloned();
    let mut urls = upstream_url_candidates(&account.base_url, upstream_path);
    if let Some(url) = cached {
        urls.retain(|candidate| candidate != &url);
        urls.insert(0, url);
    }

    let client = &*UPSTREAM_CLIENT;
    let mut last_missing = None;
    for url in urls {
        let mut req = match method {
            "POST" => client.post(&url),
            "DELETE" => client.delete(&url),
            _ => client.get(&url),
        };
        req = req
            .header("Authorization", format!("Bearer {}", account.api_key))
            .header("Content-Type", "application/json");
        if let Some(value) = body {
            req = req.json(value);
        }

        let resp = req
            .send()
            .await
            .map_err(|error| format!("Upstream request failed at {url}: {error}"))?;
        let status = resp.status().as_u16();
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("application/json")
            .to_string();
        let text = resp
            .text()
            .await
            .map_err(|error| format!("Failed to read response from {url}: {error}"))?;
        let parsed = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text));

        if route_is_missing(status, &parsed) {
            UPSTREAM_ROUTE_CACHE.lock().remove(&cache_key);
            last_missing = Some((status, content_type, parsed));
            continue;
        }
        UPSTREAM_ROUTE_CACHE.lock().insert(cache_key.clone(), url);
        return Ok((status, content_type, parsed));
    }

    Ok(last_missing.unwrap_or_else(|| {
        (
            404,
            "application/json".into(),
            json!({"error": {
                "message": "No compatible OpenAI route was found for the configured provider URL.",
                "type": "bridge_route_error"
            }}),
        )
    }))
}

fn openai_messages_to_gemini(body: &Value) -> (Vec<Value>, Option<Value>) {
    let mut contents = Vec::new();
    let mut system_parts = Vec::new();
    for message in body
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");
        let text = stringify_content(message.get("content").unwrap_or(&Value::Null));
        if text.is_empty() {
            continue;
        }
        if role == "system" || role == "developer" {
            system_parts.push(json!({"text": text}));
        } else {
            contents.push(json!({
                "role": if role == "assistant" { "model" } else { "user" },
                "parts": [{"text": text}],
            }));
        }
    }
    let system = (!system_parts.is_empty()).then(|| json!({"parts": system_parts}));
    (contents, system)
}

fn native_chat_request(protocol: AccountProvider, body: &Value) -> Value {
    let model = body
        .get("model")
        .cloned()
        .unwrap_or(Value::String(String::new()));
    match protocol {
        AccountProvider::Gemini => {
            let (contents, system) = openai_messages_to_gemini(body);
            let mut generation = serde_json::Map::new();
            if let Some(value) = body
                .get("max_completion_tokens")
                .or_else(|| body.get("max_tokens"))
            {
                generation.insert("maxOutputTokens".into(), value.clone());
            }
            if let Some(value) = body.get("temperature") {
                generation.insert("temperature".into(), value.clone());
            }
            if let Some(value) = body.get("top_p") {
                generation.insert("topP".into(), value.clone());
            }
            if let Some(value) = body.get("stop") {
                generation.insert("stopSequences".into(), value.clone());
            }
            let mut request = json!({"contents": contents, "generationConfig": generation});
            if let Some(system) = system {
                request["systemInstruction"] = system;
            }
            request
        }
        AccountProvider::Ollama => {
            let mut options = serde_json::Map::new();
            if let Some(value) = body
                .get("max_completion_tokens")
                .or_else(|| body.get("max_tokens"))
            {
                options.insert("num_predict".into(), value.clone());
            }
            if let Some(value) = body.get("temperature") {
                options.insert("temperature".into(), value.clone());
            }
            if let Some(value) = body.get("top_p") {
                options.insert("top_p".into(), value.clone());
            }
            if let Some(value) = body.get("seed") {
                options.insert("seed".into(), value.clone());
            }
            if let Some(value) = body.get("stop") {
                options.insert("stop".into(), value.clone());
            }
            json!({"model": model, "messages": body.get("messages").cloned().unwrap_or_else(|| json!([])), "stream": false, "options": options})
        }
        AccountProvider::Cohere => json!({
            "model": model,
            "messages": body.get("messages").cloned().unwrap_or_else(|| json!([])),
            "stream": false,
            "max_tokens": body.get("max_completion_tokens").or_else(|| body.get("max_tokens")).cloned(),
            "temperature": body.get("temperature").cloned(),
            "p": body.get("top_p").cloned(),
            "seed": body.get("seed").cloned(),
            "stop_sequences": body.get("stop").cloned(),
        }),
        _ => body.clone(),
    }
}

fn native_chat_response(protocol: AccountProvider, raw: Value, model: &str) -> Value {
    let content = match protocol {
        AccountProvider::Gemini => raw
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        AccountProvider::Ollama | AccountProvider::Cohere => raw
            .pointer("/message/content")
            .map(stringify_content)
            .unwrap_or_default(),
        _ => String::new(),
    };
    json!({
        "id": format!("chatcmpl_{}", Uuid::new_v4().as_simple()),
        "object": "chat.completion",
        "created": Utc::now().timestamp(),
        "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "provider_response": raw,
    })
}

async fn forward_native_chat_upstream(
    account: &UpstreamAccount,
    protocol: AccountProvider,
    upstream_path: &str,
    method: &str,
    body: Option<&Value>,
) -> Result<(u16, String, Value), String> {
    if method != "POST" || upstream_path != "/v1/chat/completions" {
        return Ok((
            400,
            "application/json".into(),
            json!({"error": {
                "message": "This native protocol adapter currently accepts OpenAI-compatible POST /v1/chat/completions requests.",
                "type": "bridge_protocol_error"
            }}),
        ));
    }
    let incoming = body.unwrap_or(&Value::Null);
    if is_truthy(incoming.get("stream")) {
        return Ok((
            400,
            "application/json".into(),
            json!({"error": {
                "message": "Streaming through this native protocol adapter is not yet available; use the provider-native Playground or disable stream.",
                "type": "bridge_protocol_error"
            }}),
        ));
    }
    let model = incoming.get("model").and_then(Value::as_str).unwrap_or("");
    let request_body = native_chat_request(protocol, incoming);
    let supplied = account.base_url.trim().trim_end_matches('/');
    let url = match protocol {
        AccountProvider::Gemini => {
            let root = supplied.trim_end_matches("/v1beta");
            format!(
                "{root}/v1beta/models/{}:generateContent",
                model.trim_start_matches("models/")
            )
        }
        AccountProvider::Ollama => format!("{}/api/chat", supplied.trim_end_matches("/api")),
        AccountProvider::Cohere => upstream_url(supplied, "/v2/chat"),
        _ => return Err("Unsupported native protocol adapter".into()),
    };
    let mut request = UPSTREAM_CLIENT
        .post(&url)
        .header("content-type", "application/json");
    request = match protocol {
        AccountProvider::Gemini => request.header("x-goog-api-key", &account.api_key),
        AccountProvider::Ollama => request,
        _ => request.header("Authorization", format!("Bearer {}", account.api_key)),
    };
    let response = request
        .json(&request_body)
        .send()
        .await
        .map_err(|error| format!("Native upstream request failed at {url}: {error}"))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let text = response.text().await.unwrap_or_default();
    let raw = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text));
    if !(200..300).contains(&status) {
        return Ok((status, content_type, raw));
    }
    Ok((
        status,
        "application/json".into(),
        native_chat_response(protocol, raw, model),
    ))
}

/// Forward to a v0 provider.
async fn forward_v0_request(
    account: &UpstreamAccount,
    upstream_path: &str,
    method: &str,
    body: Option<&Value>,
) -> Result<(u16, String, Value), String> {
    // v0 only supports GET /v1/models and POST /v1/chat/completions
    if method == "GET" && upstream_path == "/v1/models" {
        let models: Vec<Value> = V0_MODELS
            .iter()
            .map(|id| json!({"id": id, "object": "model", "owned_by": "v0"}))
            .collect();
        return Ok((
            200,
            "application/json".into(),
            json!({"object": "list", "data": models}),
        ));
    }

    if method != "POST" || upstream_path != "/v1/chat/completions" {
        return Ok((
            400,
            "application/json".into(),
            json!({"error": {
                "message": "v0 accounts currently support /v1/models and /v1/chat/completions through this bridge.",
                "type": "bridge_provider_error",
            }}),
        ));
    }

    let request_body = body.unwrap_or(&Value::Null);
    let model = request_body
        .get("model")
        .and_then(|v| v.as_str())
        .filter(|m| V0_MODELS.contains(m))
        .unwrap_or(V0_MODELS[0]);

    // Flatten the chat transcript into v0's single `message` field, matching
    // `extractV0Message` (bridgeServer.ts:1431-1449) — structured content parts
    // are reduced to their text, not dumped as raw JSON.
    let message = request_body
        .get("messages")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|msg| {
                    let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
                    let content = stringify_content(msg.get("content").unwrap_or(&Value::Null));
                    if content.is_empty() {
                        None
                    } else {
                        Some(format!("{role}: {content}"))
                    }
                })
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .unwrap_or_default();

    let url = format!("{}/chats", account.base_url);
    let body = json!({
        "message": message,
        "responseMode": "sync",
        "modelConfiguration": {
            "modelId": model,
            "imageGenerations": false,
            "thinking": false,
        },
    });

    let client = &*UPSTREAM_CLIENT;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", account.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("v0 request failed: {e}"))?;

    let status = resp.status();
    let status_code = status.as_u16();
    let is_success = status.is_success();
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let text = resp.text().await.unwrap_or_default();
    let raw: Value = serde_json::from_str(&text).unwrap_or(Value::String(text.clone()));

    if !is_success {
        return Ok((status_code, ct, raw));
    }

    // Map v0 response to OpenAI chat format. `extractV0Text` trims and only
    // accepts non-blank text before falling through to the placeholder.
    let chat_text = raw
        .get("text")
        .and_then(|t| t.as_str())
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .or_else(|| {
            raw.pointer("/latestVersion/text")
                .and_then(|t| t.as_str())
                .map(str::trim)
                .filter(|t| !t.is_empty())
        })
        .unwrap_or("v0 completed the request.");

    let mut lines = vec![chat_text.to_string()];
    if let Some(url) = raw.get("webUrl").and_then(|u| u.as_str()) {
        if !url.trim().is_empty() {
            lines.push(format!("\nChat URL: {}", url.trim()));
        }
    }
    if let Some(files) = raw
        .pointer("/latestVersion/files")
        .and_then(|f| f.as_array())
    {
        let names: Vec<&str> = files
            .iter()
            .filter_map(|f| f.get("name").and_then(|n| n.as_str()))
            .take(20)
            .collect();
        if !names.is_empty() {
            let list = names
                .iter()
                .map(|n| format!("- {n}"))
                .collect::<Vec<_>>()
                .join("\n");
            lines.push(format!("\nGenerated files:\n{list}"));
        }
    }

    // The JS joins these sections with "\n"; each appended section already
    // carries its own leading newline.
    let content = lines.join("\n");
    let created = Utc::now().timestamp() as u64;
    let id = raw
        .get("id")
        .and_then(|i| i.as_str())
        .map(|i| format!("chatcmpl_{i}"))
        .unwrap_or_else(|| format!("chatcmpl_{}", Uuid::new_v4().as_simple()));

    Ok((
        200,
        "application/json".into(),
        json!({
            "id": id,
            "object": "chat.completion",
            "created": created,
            "model": model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
            "v0": raw,
        }),
    ))
}

/// Forward to an Anthropic provider.
///
/// When the upstream account is configured as `AccountProvider::Anthropic`,
/// we forward to `{base_url}/v1/messages` with `x-api-key` headers.
///
/// If `upstream_path` is `/v1/messages`, the body is already in Anthropic
/// format and is forwarded as-is. If `upstream_path` is `/v1/chat/completions`
/// (from `chat_completions_handler`), the body is in OpenAI format and is
/// converted via `openai_to_anthropic_request` first.
async fn forward_anthropic_upstream(
    account: &UpstreamAccount,
    upstream_path: &str,
    method: &str,
    body: Option<&Value>,
) -> Result<(u16, String, Value), String> {
    // Only forward POST to /v1/messages — other methods aren't part of the
    // Anthropic Messages API.
    if method != "POST" {
        return Ok((
            400,
            "application/json".into(),
            json!({"type": "error", "error": {"type": "invalid_request_error", "message": "Anthropic upstream only supports POST /v1/messages"}}),
        ));
    }

    // Determine whether the body needs conversion from OpenAI → Anthropic.
    // If the request came from `/v1/messages`, it's already Anthropic format.
    // If from `/v1/chat/completions`, it's OpenAI format and needs conversion.
    let forward_body = if upstream_path == "/v1/chat/completions" {
        let request_body = body.unwrap_or(&Value::Null);
        let model = request_body
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("claude-sonnet-4-20250514");
        openai_to_anthropic_request(request_body, model)
    } else {
        body.cloned().unwrap_or(json!({}))
    };

    let cache_key = route_cache_key(&account.base_url, "/v1/messages");
    let cached = UPSTREAM_ROUTE_CACHE.lock().get(&cache_key).cloned();
    let mut urls = upstream_url_candidates(&account.base_url, "/v1/messages");
    if let Some(url) = cached {
        urls.retain(|candidate| candidate != &url);
        urls.insert(0, url);
    }

    let client = &*UPSTREAM_CLIENT;
    let mut last_missing = None;
    for url in urls {
        let resp = client
            .post(&url)
            .header("x-api-key", &account.api_key)
            .header("Authorization", format!("Bearer {}", account.api_key))
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&forward_body)
            .send()
            .await
            .map_err(|error| format!("Anthropic upstream request failed at {url}: {error}"))?;
        let status = resp.status().as_u16();
        let ct = resp
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("application/json")
            .to_string();
        let text = resp.text().await.unwrap_or_default();
        let parsed = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text));
        if route_is_missing(status, &parsed) {
            UPSTREAM_ROUTE_CACHE.lock().remove(&cache_key);
            last_missing = Some((status, ct, parsed));
            continue;
        }
        UPSTREAM_ROUTE_CACHE.lock().insert(cache_key.clone(), url);
        return Ok((status, ct, parsed));
    }

    Ok(last_missing.unwrap_or_else(|| (404, "application/json".into(), json!({"type": "error", "error": {
        "type": "not_found_error",
        "message": "No compatible Anthropic Messages route was found for the configured provider URL."
    }}))))
}

/// Convert an OpenAI chat-completions request body into an Anthropic Messages
/// request body, for forwarding to an Anthropic upstream.
///
/// This is the inverse of `anthropic_to_openai`: it reconstructs the
/// Anthropic-native request shape so that Anthropic's API receives a body
/// it understands directly, avoiding a lossy round-trip.
fn openai_to_anthropic_request(body: &Value, model: &str) -> Value {
    let mut messages = Vec::new();

    // Extract system message(s) from the OpenAI messages array and convert
    // to the Anthropic top-level `system` field.
    let mut system_parts: Vec<Value> = Vec::new();
    let mut non_system: Vec<Value> = Vec::new();

    if let Some(msgs) = body.get("messages").and_then(|m| m.as_array()) {
        for msg in msgs {
            let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if role == "system" {
                // System messages become content blocks for the `system` field.
                if let Some(content) = msg.get("content") {
                    match content {
                        Value::String(s) => {
                            system_parts.push(json!({"type": "text", "text": s}));
                        }
                        Value::Array(arr) => {
                            for part in arr {
                                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                                    system_parts.push(json!({"type": "text", "text": text}));
                                } else if part.get("type").and_then(|t| t.as_str()) == Some("text")
                                {
                                    system_parts.push(part.clone());
                                }
                            }
                        }
                        _ => {}
                    }
                }
            } else {
                non_system.push(msg.clone());
            }
        }
    }

    // Convert message content to Anthropic format (string → string,
    // array of parts → array of content blocks).
    for msg in &non_system {
        let mut anthropic_msg = json!({
            "role": msg.get("role").and_then(|r| r.as_str()).unwrap_or("user"),
        });
        if let Some(content) = msg.get("content") {
            match content {
                Value::String(s) => {
                    anthropic_msg["content"] = Value::String(s.clone());
                }
                Value::Array(parts) => {
                    let blocks: Vec<Value> = parts
                        .iter()
                        .filter_map(|part| {
                            let ptype = part.get("type").and_then(|t| t.as_str())?;
                            match ptype {
                                "text" => Some(json!({
                                    "type": "text",
                                    "text": part.get("text").and_then(|t| t.as_str()).unwrap_or(""),
                                })),
                                "image_url" => {
                                    // OpenAI image_url → Anthropic image source
                                    let url =
                                        part.pointer("/image_url/url").and_then(|u| u.as_str())?;
                                    if let Some(b64) =
                                        url.strip_prefix("data:").and_then(|d| d.split(',').nth(1))
                                    {
                                        let media_type = url
                                            .split(';')
                                            .nth(1)
                                            .and_then(|s| {
                                                let slash = s.find('/')?;
                                                Some(s[slash + 1..].to_string())
                                            })
                                            .unwrap_or_else(|| "png".to_string());
                                        Some(json!({
                                            "type": "image",
                                            "source": {
                                                "type": "base64",
                                                "media_type": format!("image/{media_type}"),
                                                "data": b64,
                                            },
                                        }))
                                    } else {
                                        Some(json!({
                                            "type": "image",
                                            "source": {
                                                "type": "url",
                                                "url": url,
                                            },
                                        }))
                                    }
                                }
                                "tool_call" => {
                                    let call_id =
                                        part.get("id").and_then(|i| i.as_str()).unwrap_or("");
                                    let name = part
                                        .get("function")
                                        .and_then(|f| f.get("name"))
                                        .and_then(|n| n.as_str())
                                        .unwrap_or("");
                                    let args_str = part
                                        .get("function")
                                        .and_then(|f| f.get("arguments"))
                                        .and_then(|a| a.as_str())
                                        .unwrap_or("{}");
                                    let input: Value =
                                        serde_json::from_str(args_str).unwrap_or(json!({}));
                                    Some(json!({
                                        "type": "tool_use",
                                        "id": call_id,
                                        "name": name,
                                        "input": input,
                                    }))
                                }
                                "tool_result" => {
                                    let call_id = part
                                        .get("tool_call_id")
                                        .and_then(|i| i.as_str())
                                        .unwrap_or("");
                                    let content_val = part
                                        .get("content")
                                        .cloned()
                                        .unwrap_or(Value::String(String::new()));
                                    Some(json!({
                                        "type": "tool_result",
                                        "tool_use_id": call_id,
                                        "content": content_val,
                                    }))
                                }
                                _ => None,
                            }
                        })
                        .collect();
                    anthropic_msg["content"] = Value::Array(blocks);
                }
                _ => {
                    anthropic_msg["content"] = content.clone();
                }
            }
        }
        messages.push(anthropic_msg);
    }

    let mut anthropic_body = json!({
        "model": model,
        "messages": messages,
    });

    // System field (only if non-empty).
    if !system_parts.is_empty() {
        anthropic_body["system"] = if system_parts.len() == 1 {
            system_parts.into_iter().next().unwrap()
        } else {
            Value::Array(system_parts)
        };
    }

    // max_tokens — Anthropic requires this; map from OpenAI's max_tokens or default 4096.
    if let Some(mt) = body.get("max_tokens") {
        anthropic_body["max_tokens"] = mt.clone();
    } else if anthropic_body.get("max_tokens").is_none() {
        anthropic_body["max_tokens"] = json!(4096);
    }

    // stop_sequences ← stop
    if let Some(stop) = body.get("stop") {
        match stop {
            Value::String(s) => {
                anthropic_body["stop_sequences"] = json!([s]);
            }
            Value::Array(arr) => {
                anthropic_body["stop_sequences"] = Value::Array(arr.clone());
            }
            _ => {}
        }
    }

    // temperature
    if let Some(temp) = body.get("temperature") {
        anthropic_body["temperature"] = temp.clone();
    }

    // top_p
    if let Some(tp) = body.get("top_p") {
        anthropic_body["top_p"] = tp.clone();
    }

    // stream
    if let Some(stream) = body.get("stream") {
        anthropic_body["stream"] = stream.clone();
    }

    // tools
    if let Some(tools) = body.get("tools") {
        anthropic_body["tools"] = tools.clone();
    }

    // tool_choice
    if let Some(tc) = body.get("tool_choice") {
        anthropic_body["tool_choice"] = tc.clone();
    }

    anthropic_body
}

// ─── Agent loop for Responses API ───────────────────────────────────────────

/// A locally executed tool call plus its output, as Responses output items.
struct StreamToolItem {
    call: Value,
    output: Value,
}

/// Run the agent loop: forward to chat, execute local tools, repeat.
///
/// Returns the final upstream triple plus the tool call/output items produced
/// along the way, which the streaming writer replays as output events
/// (`pendingStreamToolItems`, bridgeServer.ts:650-666).
async fn run_responses_agent_loop(
    state: &AppState,
    initial_chat_body: Value,
    request_body: &Value,
) -> (u16, String, Value, Vec<StreamToolItem>) {
    let mut chat_body = initial_chat_body;
    let mut stream_tool_items: Vec<StreamToolItem> = Vec::new();

    for _turn in 0..MAX_AGENT_TURNS {
        let (status, ct, resp_body) = forward_request(
            state,
            "/v1/responses",
            "/v1/chat/completions",
            "POST",
            Some(&chat_body),
        )
        .await;

        let is_json = ct.contains("application/json");
        let is_success = (200..300).contains(&status);

        if !is_json || !is_success {
            return (status, ct, resp_body, stream_tool_items);
        }

        let response_message = resp_body
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|a| a.first())
            .and_then(|c| c.get("message"));

        let tool_calls: Vec<Value> = response_message
            .and_then(|m| m.get("tool_calls"))
            .and_then(|tc| tc.as_array())
            .cloned()
            .unwrap_or_default();

        if tool_calls.is_empty() {
            return (status, ct, resp_body, stream_tool_items);
        }

        // Only intercept tool calls the *client* declared as functions we can
        // run locally. Responses-format tools carry `name` at the top level;
        // chat-format tools nest it under `function` — accept both so a client
        // posting either shape is handled (bridgeServer.ts:580-600).
        let declares_local_tool = request_body
            .get("tools")
            .and_then(|t| t.as_array())
            .map(|tools| {
                tools.iter().any(|tool| {
                    let name = tool
                        .get("name")
                        .or_else(|| tool.pointer("/function/name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("");
                    is_shell_tool_name(name) || is_file_tool_name(name)
                })
            })
            .unwrap_or(false);

        if !declares_local_tool {
            return (status, ct, resp_body, stream_tool_items);
        }

        let mut tool_messages: Vec<Value> = Vec::new();
        let mut fatal_tool_error = false;

        for tc in &tool_calls {
            let tool_name = tc
                .pointer("/function/name")
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let Some(tc_id) = tc
                .get("id")
                .and_then(|i| i.as_str())
                .filter(|id| !id.is_empty())
            else {
                continue;
            };
            let args = tc
                .pointer("/function/arguments")
                .and_then(|a| a.as_str())
                .unwrap_or("{}");

            if !is_shell_tool_name(tool_name) && !is_file_tool_name(tool_name) {
                continue;
            }

            let (result, fatal) = execute_tool_call(tool_name, args).await;
            fatal_tool_error |= fatal;

            let output = serde_json::to_string(&result).unwrap_or_default();
            tool_messages.push(json!({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": output,
            }));
            stream_tool_items.push(StreamToolItem {
                call: json!({
                    "id": tc_id,
                    "type": "function_call",
                    "call_id": tc_id,
                    "name": tool_name,
                    "arguments": args,
                    "status": "completed",
                }),
                output: json!({
                    "id": format!("fco_{}", sanitize_item_id(tc_id)),
                    "type": "function_call_output",
                    "call_id": tc_id,
                    "output": output,
                    "status": "completed",
                }),
            });
        }

        // Nothing ran, or a tool failed unrecoverably: hand the model's own
        // response back rather than looping on a dead end.
        if tool_messages.is_empty() || fatal_tool_error {
            return (status, ct, resp_body, stream_tool_items);
        }

        let assistant_message = json!({
            "role": "assistant",
            "content": response_message
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or(""),
            "tool_calls": tool_calls,
        });

        let Some(messages) = chat_body.get_mut("messages").and_then(|m| m.as_array_mut()) else {
            return (status, ct, resp_body, stream_tool_items);
        };
        messages.push(assistant_message);
        messages.append(&mut tool_messages);
    }

    (
        400,
        "application/json".into(),
        json!({"error": {
            "message": "Agent loop exceeded maximum shell tool turns.",
            "type": "bridge_agent_loop_error",
        }}),
        stream_tool_items,
    )
}

/// Strip characters the Responses item-id grammar rejects, mirroring the JS
/// `replace(/[^a-zA-Z0-9_-]/g, "")`.
fn sanitize_item_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

// ─── axum Handlers ──────────────────────────────────────────────────────────

type ServerState = Arc<AppState>;

async fn health_handler(AxumState(state): AxumState<ServerState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "service": "sparkly-api",
        "endpoint": format!("http://localhost:{DEFAULT_LOCAL_PORT}"),
        "uptimeMs": state.started_at.elapsed().as_millis() as u64,
    }))
}

async fn stats_handler(
    AxumState(state): AxumState<ServerState>,
    headers: axum::http::HeaderMap,
) -> Response {
    if let Err((status, message, error_type)) = check_auth(&state, &headers).await {
        return json_error(status, &message, &error_type);
    }
    let mut stats = state.stats.read().await.clone();
    stats.uptime_ms = state.started_at.elapsed().as_millis() as u64;
    stats.active_model_count = state.config.read().await.models.len();
    stats.last_request_at = state
        .logs
        .read()
        .await
        .first()
        .map(|entry| entry.timestamp.clone());
    Json(stats).into_response()
}

async fn logs_handler(
    AxumState(state): AxumState<ServerState>,
    headers: axum::http::HeaderMap,
) -> Response {
    if let Err((status, message, error_type)) = check_auth(&state, &headers).await {
        return json_error(status, &message, &error_type);
    }
    let logs = state.logs.read().await.clone();
    Json(json!({"data": logs})).into_response()
}

/// `/v1` intentionally returns a compact not-found response.
async fn v1_index_handler() -> Response {
    (StatusCode::NOT_FOUND, Json(json!({"detail": "Not Found"}))).into_response()
}

async fn check_auth(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<(), (StatusCode, String, String)> {
    // MITM requests are already accepted on the local administrator-controlled
    // listener. Require the exact marker plus a non-empty correlation ID so an
    // Antigravity cloud Authorization token is never mistaken for a Sparkly key.
    let is_internal_mitm = headers
        .get("x-sparkly-mitm")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == "1")
        && headers
            .get("x-sparkly-request-id")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("mitm-"));
    if is_internal_mitm {
        tracing::debug!(
            "[MITM] Internal bridge authentication accepted for request {:?}",
            headers.get("x-sparkly-request-id")
        );
        return Ok(());
    }

    let api_key = if let Some(auth_header) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                Some(token.trim().to_string())
            } else {
                Some(auth_str.trim().to_string())
            }
        } else {
            None
        }
    } else if let Some(x_api_key_header) = headers.get("x-api-key") {
        if let Ok(x_key_str) = x_api_key_header.to_str() {
            Some(x_key_str.trim().to_string())
        } else {
            None
        }
    } else {
        None
    };

    let Some(key) = api_key else {
        return Err((
            StatusCode::UNAUTHORIZED,
            "API key is missing.".to_string(),
            "authentication_error".to_string(),
        ));
    };

    let client_keys = state.client_keys.read().await;
    let matched = client_keys.iter().any(|k| k.key == key && k.is_active);

    if matched {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            "Incorrect or inactive API key.".to_string(),
            "authentication_error".to_string(),
        ))
    }
}

fn ensure_structured_error(status: u16, body: &Value) -> Value {
    if let Some(error_obj) = body.get("error") {
        if error_obj.get("message").is_some() {
            return body.clone();
        }
    }

    let message = match body {
        Value::String(s) => {
            let title = extract_html_title(s);
            if !title.is_empty() {
                format!("Upstream error: {}", title)
            } else if s.len() > 512 {
                format!("{}...", &s[..512])
            } else {
                s.clone()
            }
        }
        other => {
            let s = other.to_string();
            if s.is_empty() {
                "Unknown upstream error.".to_string()
            } else {
                s
            }
        }
    };

    let error_type = if status == 401 {
        "authentication_error"
    } else if status == 403 {
        "permission_error"
    } else if status == 429 {
        "rate_limit_error"
    } else if status >= 500 {
        "api_error"
    } else {
        "invalid_request_error"
    };

    json!({
        "error": {
            "message": message,
            "type": error_type,
        }
    })
}

async fn v1_models_handler(
    AxumState(state): AxumState<ServerState>,
    headers: axum::http::HeaderMap,
) -> Response {
    if let Err((status, msg, err_type)) = check_auth(&state, &headers).await {
        return json_error(status, &msg, &err_type);
    }

    let config = state.config.read().await;
    if !has_configured_upstream(&config) {
        return json_error(
            StatusCode::BAD_REQUEST,
            "API key is not configured.",
            "bridge_config_error",
        );
    }
    drop(config);

    let (status, ct, body) = forward_request(&state, "/v1/models", "/v1/models", "GET", None).await;
    if status >= 400 {
        let structured_error = ensure_structured_error(status, &body);
        return build_upstream_response(status, "application/json", &structured_error);
    }
    build_upstream_response(status, &ct, &body)
}

async fn chat_completions_handler(
    AxumState(state): AxumState<ServerState>,
    headers: axum::http::HeaderMap,
    body: Result<Json<Value>, JsonRejection>,
) -> Response {
    if let Err((status, msg, err_type)) = check_auth(&state, &headers).await {
        return json_error(status, &msg, &err_type);
    }

    let mut body = match json_body_or_error(body) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let config = state.config.read().await.clone();
    if !has_configured_upstream(&config) {
        return json_error(
            StatusCode::BAD_REQUEST,
            "API key is not configured.",
            "bridge_config_error",
        );
    }

    apply_model_defaults(&mut body, &config);

    let model = extract_model(&body);
    let model_str = model.clone().unwrap_or_default();
    if model_str != "auto" && !config.models.contains(&model_str) {
        return json_error(
            StatusCode::NOT_FOUND,
            &format!("The model `{}` does not exist.", model_str),
            "invalid_request_error",
        );
    }

    let (status, ct, resp_body) = forward_request(
        &state,
        "/v1/chat/completions",
        "/v1/chat/completions",
        "POST",
        Some(&body),
    )
    .await;

    if status >= 400 {
        if let Some(m) = model {
            if let Some(entry) = state.logs.write().await.first_mut() {
                entry.model = Some(m);
            }
        }
        let structured_error = ensure_structured_error(status, &resp_body);
        return build_upstream_response(status, "application/json", &structured_error);
    }

    build_upstream_response(status, &ct, &resp_body)
}

// ─── Anthropic /v1/messages compatibility ──────────────────────────────────

/// Convert an Anthropic Messages request into an OpenAI chat-completions
/// request so it can be proxied through the existing `forward_request` path.
///
/// Key shape differences handled:
/// - Anthropic puts the system prompt in a top-level `system` field (string
///   or content-block array), not as a `role: "system"` message.
/// - `max_tokens` is required (we default to 4096 if missing).
/// - Message `content` may be a string or an array of typed blocks; OpenAI
///   accepts a string or an array of `{type:"text",text}` parts.
/// - `metadata.user_id` → `user`.
/// - `stop_sequences` → `stop`.
fn anthropic_to_openai(body: &Value, config: &BridgeConfig) -> Value {
    let model = body
        .get("model")
        .and_then(|v| v.as_str())
        .filter(|m| !m.is_empty())
        .unwrap_or(&config.selected_model)
        .to_string();

    let mut messages: Vec<Value> = Vec::new();

    // System prompt: top-level `system` (string or content-block array).
    if let Some(system) = body.get("system") {
        let sys_text = match system {
            Value::String(s) => s.clone(),
            Value::Array(blocks) => blocks
                .iter()
                .map(|b| {
                    // Strip cache_control — not supported by upstream OpenAI.
                    let mut block = b.clone();
                    if let Some(obj) = block.as_object_mut() {
                        obj.remove("cache_control");
                    }
                    block
                })
                .filter_map(|b| {
                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                        b.get("text").and_then(|v| v.as_str()).map(String::from)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n"),
            _ => String::new(),
        };
        if !sys_text.is_empty() {
            messages.push(json!({"role": "system", "content": sys_text}));
        }
    } else if !config.system_prompt.is_empty() {
        // Fall back to the bridge's configured system prompt.
        messages.push(json!({"role": "system", "content": config.system_prompt}));
    }

    // Convert each message.
    if let Some(msgs) = body.get("messages").and_then(|v| v.as_array()) {
        for msg in msgs {
            let role = msg
                .get("role")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string();
            let content = msg.get("content");

            // Handle tool_result blocks in user messages → individual role:"tool" messages.
            // Non-tool blocks (text, images) in the same message become a separate
            // role:"user" message so they are not silently dropped.
            if role == "user" {
                if let Some(Value::Array(blocks)) = content {
                    if blocks
                        .iter()
                        .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
                    {
                        // H2: extract text from tool_result content (string or array of blocks).
                        fn tool_result_text(block: &Value) -> String {
                            match block.get("content") {
                                Some(Value::String(s)) => s.clone(),
                                Some(Value::Array(parts)) => parts
                                    .iter()
                                    .map(|p| match p.get("type").and_then(|t| t.as_str()) {
                                        Some("text") => {
                                            p.get("text").and_then(|v| v.as_str()).unwrap_or("")
                                        }
                                        Some("image") => "[Image]",
                                        _ => p.get("text").and_then(|v| v.as_str()).unwrap_or(""),
                                    })
                                    .filter(|s| !s.is_empty())
                                    .collect::<Vec<_>>()
                                    .join("\n"),
                                _ => String::new(),
                            }
                        }

                        let mut user_parts: Vec<&Value> = Vec::new();
                        for block in blocks {
                            if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                                let tool_use_id = block
                                    .get("tool_use_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let is_error = block
                                    .get("is_error")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                let result_text = tool_result_text(block);
                                let content_str = if is_error {
                                    format!("Error: {result_text}")
                                } else {
                                    result_text
                                };
                                messages.push(json!({"role": "tool", "tool_call_id": tool_use_id, "content": content_str}));
                            } else {
                                // Collect non-tool blocks for the user message.
                                user_parts.push(block);
                            }
                        }
                        // H1: emit remaining non-tool blocks as a user message.
                        if !user_parts.is_empty() {
                            let user_content: Value = user_parts.into_iter().cloned().collect();
                            messages.push(json!({"role": "user", "content": user_content}));
                        }
                        continue;
                    }
                }
            }

            // Handle tool_use blocks in assistant messages → OpenAI tool_calls format
            if role == "assistant" {
                if let Some(Value::Array(blocks)) = content {
                    if blocks
                        .iter()
                        .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
                    {
                        let text_parts: Vec<String> = blocks
                            .iter()
                            .filter_map(|b| {
                                if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                                    b.get("text").and_then(|v| v.as_str()).map(String::from)
                                } else {
                                    None
                                }
                            })
                            .collect();
                        let content_str = text_parts.join("\n");
                        let tool_calls: Vec<Value> = blocks
                            .iter()
                            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
                            .map(|b| {
                                let name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                let input = b.get("input").cloned().unwrap_or(json!({}));
                                let arguments = serde_json::to_string(&input)
                                    .unwrap_or_else(|_| "{}".to_string());
                                json!({
                                    "id": b.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                                    "type": "function",
                                    "function": {
                                        "name": name,
                                        "arguments": arguments
                                    }
                                })
                            })
                            .collect();
                        let mut msg_obj = json!({"role": "assistant"});
                        if !content_str.is_empty() {
                            msg_obj["content"] = json!(content_str);
                        } else {
                            msg_obj["content"] = json!(null);
                        }
                        if !tool_calls.is_empty() {
                            msg_obj["tool_calls"] = Value::Array(tool_calls);
                        }
                        messages.push(msg_obj);
                        continue;
                    }
                }
            }

            let converted = match content {
                Some(Value::String(s)) => json!(s),
                Some(Value::Array(blocks)) => {
                    let parts: Vec<Value> = blocks
                        .iter()
                        .filter_map(|b| {
                            match b.get("type").and_then(|t| t.as_str()) {
                                Some("text") => Some(json!({
                                    "type": "text",
                                    "text": b.get("text").and_then(|v| v.as_str()).unwrap_or("")
                                })),
                                Some("image") => {
                                    // Anthropic image: {source:{type:"base64",media_type,data}}
                                    //            or: {source:{type:"url",url:"..."}}
                                    // OpenAI image_url: {image_url:{url:"..."}}
                                    b.get("source").and_then(|s| {
                                        let source_type = s.get("type").and_then(|v| v.as_str()).unwrap_or("base64");
                                        let url = if source_type == "url" {
                                            s.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string()
                                        } else {
                                            let mt = s.get("media_type").and_then(|v| v.as_str()).unwrap_or("image/png");
                                            let data = s.get("data").and_then(|v| v.as_str()).unwrap_or("");
                                            format!("data:{mt};base64,{data}")
                                        };
                                        Some(json!({"type": "image_url", "image_url": {"url": url}}))
                                    })
                                }
                                Some("document") => {
                                    // Anthropic document: {type:"document",source:{type:"base64",media_type,data}}
                                    b.get("source").and_then(|s| {
                                        let source_type = s.get("type").and_then(|v| v.as_str()).unwrap_or("base64");
                                        let media_type = s.get("media_type").and_then(|v| v.as_str()).unwrap_or("");
                                        if source_type == "base64" {
                                            match media_type {
                                                "application/pdf" => {
                                                    // Pass PDF as a data: URL image (providers that support it will render it)
                                                    let data = s.get("data").and_then(|v| v.as_str()).unwrap_or("");
                                                    let url = format!("data:application/pdf;base64,{data}");
                                                    Some(json!({"type": "image_url", "image_url": {"url": url}}))
                                                }
                                                mt if mt.starts_with("text/") => {
                                                    // Extract text content from text/plain or text/* documents
                                                    let data = s.get("data").and_then(|v| v.as_str()).unwrap_or("");
                                                    match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data) {
                                                        Ok(bytes) => {
                                                            let text = String::from_utf8_lossy(&bytes).to_string();
                                                            Some(json!({"type": "text", "text": text}))
                                                        }
                                                        Err(_) => Some(json!({"type": "text", "text": "[Unable to decode document]"})),
                                                    }
                                                }
                                                _ => Some(json!({"type": "text", "text": "[Unsupported document type]"})),
                                            }
                                        } else if source_type == "url" {
                                            let url = s.get("url").and_then(|v| v.as_str()).unwrap_or("");
                                            let media_type = s.get("media_type").and_then(|v| v.as_str()).unwrap_or("");
                                            if media_type == "application/pdf" || url.ends_with(".pdf") {
                                                Some(json!({"type": "image_url", "image_url": {"url": url}}))
                                            } else {
                                                Some(json!({"type": "text", "text": url}))
                                            }
                                        } else if source_type == "text" {
                                            let text = s.get("text").and_then(|v| v.as_str()).unwrap_or("");
                                            Some(json!({"type": "text", "text": text}))
                                        } else {
                                            Some(json!({"type": "text", "text": "[Unsupported document source]"}))
                                        }
                                    })
                                }
                                _ => None,
                            }
                        })
                        .collect();
                    Value::Array(parts)
                }
                _ => json!(""),
            };
            messages.push(json!({"role": role, "content": converted}));
        }
    }

    let mut max_tokens = body
        .get("max_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(4096);

    // Anthropic allows max_tokens=0 with thinking enabled (cache warming),
    // but OpenAI rejects max_tokens=0 — bump to 1.
    let thinking_enabled = body
        .get("thinking")
        .and_then(|t| t.get("type"))
        .and_then(|v| v.as_str())
        == Some("enabled");
    if thinking_enabled && max_tokens == 0 {
        max_tokens = 1;
    }

    let mut chat_body = json!({
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
    });

    // Extended thinking: if thinking.type == "enabled", set reasoning_effort and
    // use budget_tokens as a hint for max_completion_tokens.
    if thinking_enabled {
        chat_body["reasoning_effort"] = json!("high");
        if let Some(budget) = body
            .get("thinking")
            .and_then(|t| t.get("budget_tokens"))
            .and_then(|v| v.as_u64())
        {
            chat_body["max_completion_tokens"] = json!(budget);
        }
    }

    // Pass-through optional fields.
    for (anthropic_key, openai_key) in [
        ("temperature", "temperature"),
        ("top_p", "top_p"),
        ("stop_sequences", "stop"),
    ] {
        if let Some(val) = body.get(anthropic_key) {
            chat_body[openai_key] = val.clone();
        }
    }
    if let Some(stream) = body.get("stream").and_then(|v| v.as_bool()) {
        chat_body["stream"] = json!(stream);
    }
    // Forward stream_options (e.g. include_usage) as-is.
    if let Some(opts) = body.get("stream_options") {
        chat_body["stream_options"] = opts.clone();
    }
    if let Some(uid) = body
        .get("metadata")
        .and_then(|m| m.get("user_id"))
        .and_then(|v| v.as_str())
    {
        chat_body["user"] = json!(uid);
    }

    // Map Anthropic tools → OpenAI tools format.
    if let Some(tools) = body.get("tools").and_then(|v| v.as_array()) {
        let openai_tools: Vec<Value> = tools
            .iter()
            .filter_map(|t| {
                let name = t.get("name").and_then(|v| v.as_str())?;
                let description = t.get("description").and_then(|v| v.as_str()).unwrap_or("");
                let input_schema = t.get("input_schema").cloned().unwrap_or(json!({}));
                Some(json!({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": description,
                        "parameters": input_schema
                    }
                }))
            })
            .collect();
        if !openai_tools.is_empty() {
            chat_body["tools"] = Value::Array(openai_tools);
        }
    }

    // Map Anthropic tool_choice → OpenAI tool_choice format.
    if let Some(tool_choice) = body.get("tool_choice") {
        let openai_tool_choice = match tool_choice {
            Value::String(s) => match s.as_str() {
                "auto" => Some(json!({"type": "auto"})),
                "any" => Some(json!({"type": "required"})),
                "none" => None,
                _ => Some(json!({"type": "auto"})),
            },
            Value::Object(obj) => {
                if let Some(tc_type) = obj.get("type").and_then(|v| v.as_str()) {
                    match tc_type {
                        "tool" => {
                            let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            Some(json!({"type": "function", "function": {"name": name}}))
                        }
                        "auto" => Some(json!({"type": "auto"})),
                        "any" => Some(json!({"type": "required"})),
                        "none" => None,
                        _ => Some(json!({"type": "auto"})),
                    }
                } else {
                    Some(json!({"type": "auto"}))
                }
            }
            _ => Some(json!({"type": "auto"})),
        };
        if let Some(choice) = openai_tool_choice {
            chat_body["tool_choice"] = choice;
        }
        // Forward disable_parallel_tool_use → parallel_tool_calls: false
        if tool_choice
            .get("disable_parallel_tool_use")
            .and_then(|v| v.as_bool())
            == Some(true)
        {
            chat_body["parallel_tool_calls"] = json!(false);
        }
    }

    chat_body
}

/// Convert an OpenAI chat-completion response into the Anthropic Messages
/// response shape.
fn openai_to_anthropic(chat_resp: &Value, model: &str) -> Value {
    let choice = chat_resp
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .cloned()
        .unwrap_or(json!({}));

    let message = choice.get("message").cloned().unwrap_or(json!({}));
    let text = message
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    // Map finish_reason → stop_reason.
    let finish_reason = choice.get("finish_reason").and_then(|f| f.as_str());
    let (stop_reason, stop_sequence) = match finish_reason {
        Some("stop") => {
            // If upstream included a stop_sequence, pass it through.
            let seq = choice
                .get("stop_sequence")
                .or_else(|| chat_resp.get("stop_sequence"))
                .and_then(|v| v.as_str())
                .map(|s| Value::String(s.to_string()));
            ("end_turn", seq)
        }
        Some("length") => ("max_tokens", None),
        Some("tool_calls") => ("tool_use", None),
        Some("content_filter") => ("end_turn", None),
        Some("stop_sequence") => {
            // OpenAI may report finish_reason as "stop" with stop_sequence,
            // but some providers emit it as a standalone value.
            let seq = choice
                .get("stop_sequence")
                .or_else(|| chat_resp.get("stop_sequence"))
                .and_then(|v| v.as_str())
                .map(|s| Value::String(s.to_string()));
            ("stop_sequence", seq)
        }
        _ => ("end_turn", None),
    };

    let usage = chat_resp.get("usage").cloned().unwrap_or(json!({}));
    // Accept upstream "prompt_tokens" (OpenAI) or "input_tokens" (Anthropic-native).
    let input_tokens = usage
        .get("input_tokens")
        .or_else(|| usage.get("prompt_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    // Accept upstream "completion_tokens" (OpenAI) or "output_tokens" (Anthropic-native).
    let output_tokens = usage
        .get("output_tokens")
        .or_else(|| usage.get("completion_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    // Cache token fields — map from OpenAI prompt_tokens_details if present.
    let cached_tokens = usage
        .pointer("/prompt_tokens_details/cached_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cache_write_tokens = usage
        .pointer("/prompt_tokens_details/cache_write_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    // Build content array: include reasoning content if present.
    let mut content: Vec<Value> = Vec::new();
    // Check for reasoning_content (OpenAI o1/o3 style) or reasoning field.
    let reasoning_text = message
        .get("reasoning_content")
        .and_then(|c| c.as_str())
        .or_else(|| message.get("reasoning").and_then(|c| c.as_str()))
        .unwrap_or("");
    // We cannot produce a valid cryptographic signature for a thinking block,
    // so include reasoning as a text block rather than a thinking block that
    // the Anthropic SDK would reject.
    if !reasoning_text.is_empty() {
        content.push(json!({"type": "text", "text": reasoning_text}));
    }
    if !text.is_empty() {
        content.push(json!({"type": "text", "text": text}));
    }
    // Map OpenAI tool_calls → Anthropic tool_use content blocks.
    if let Some(tool_calls) = message.get("tool_calls").and_then(|v| v.as_array()) {
        for tc in tool_calls {
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let arguments_str = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .unwrap_or("{}");
            let input: Value = serde_json::from_str(arguments_str).unwrap_or(json!({}));
            // Preserve the original OpenAI call_xxx ID for round-trip fidelity.
            let tool_use_id = tc
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("toolu_fallback")
                .to_string();
            content.push(json!({
                "type": "tool_use",
                "id": tool_use_id,
                "name": name,
                "input": input
            }));
        }
    }
    if content.is_empty() {
        content.push(json!({"type": "text", "text": ""}));
    }

    // Build the usage object with optional cache fields.
    let mut usage_obj = json!({
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
    });
    if cache_write_tokens > 0 {
        usage_obj["cache_creation_input_tokens"] = json!(cache_write_tokens);
    }
    if cached_tokens > 0 {
        usage_obj["cache_read_input_tokens"] = json!(cached_tokens);
    }
    // Pass through total_tokens if upstream included it.
    if let Some(total) = usage.get("total_tokens").and_then(|v| v.as_u64()) {
        usage_obj["total_tokens"] = json!(total);
    }

    let stop_seq = stop_sequence.unwrap_or(Value::Null);

    json!({
        "id": chat_resp.get("id")
            .and_then(|v| v.as_str())
            .map(|s| if s.starts_with("msg_") { s.to_string() }
                  else { format!("msg_{}", Uuid::new_v4().simple()) })
            .unwrap_or_else(|| format!("msg_{}", Uuid::new_v4().simple())),
        "type": "message",
        "role": "assistant",
        "content": content,
        "model": model,
        "stop_reason": stop_reason,
        "stop_sequence": stop_seq,
        "usage": usage_obj
    })
}

/// Anthropic error shape: `{"type":"error","error":{"type":"...","message":"..."}}`
fn anthropic_error_response(status: StatusCode, error_type: &str, message: &str) -> Response {
    (
        status,
        Json(json!({
            "type": "error",
            "error": {
                "type": error_type,
                "message": message
            }
        })),
    )
        .into_response()
}

/// Parse buffered OpenAI SSE text and rebuild it as Anthropic Messages SSE.
///
/// The upstream `forward_request` buffers the entire response, so this emits
/// all events in one batch — acceptable for a proxy.
///
/// OpenAI SSE chunks look like:
///
///     data: {"id":"...","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}
///     data: {"id":"...","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
///     data: [DONE]
///
/// Anthropic SSE looks like:
///
///     event: message_start
///     data: {"type":"message_start",...}
///
///     event: content_block_start
///     data: {"type":"content_block_start","index":0,...}
///
///     event: content_block_delta
///     data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}
///
///     event: content_block_stop
///     data: {"type":"content_block_stop","index":0}
///
///     event: message_delta
///     data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},...}
///
///     event: message_stop
///     data: {"type":"message_stop"}
fn openai_sse_to_anthropic_sse(sse_text: &str, model: &str) -> String {
    let mut chunks: Vec<Value> = Vec::new();
    let mut last_finish_reason: Option<String> = None;

    // Parse every `data:` line; skip [DONE] and non-data lines.
    for line in sse_text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("data:") {
            let rest = rest.trim();
            if rest == "[DONE]" {
                continue;
            }
            if let Ok(chunk) = serde_json::from_str::<Value>(rest) {
                // Track the latest finish_reason across all chunks.
                if let Some(fr) = chunk
                    .pointer("/choices/0/finish_reason")
                    .and_then(|v| v.as_str())
                {
                    if !fr.is_empty() {
                        last_finish_reason = Some(fr.to_string());
                    }
                }
                chunks.push(chunk);
            }
        }
    }

    let msg_id = format!("msg_{}", Uuid::new_v4().as_simple());

    // Extract input_tokens from the first chunk that carries usage.
    // Accept both "prompt_tokens" (OpenAI) and "input_tokens" (Anthropic).
    let input_tokens = chunks
        .iter()
        .find_map(|c| {
            c.get("usage").and_then(|u| {
                u.get("input_tokens")
                    .or_else(|| u.get("prompt_tokens"))
                    .and_then(|v| v.as_u64())
            })
        })
        .unwrap_or(0);

    // Extract output_tokens from the last chunk that carries usage.
    let output_tokens = chunks
        .iter()
        .rev()
        .find_map(|c| {
            c.get("usage").and_then(|u| {
                u.get("output_tokens")
                    .or_else(|| u.get("completion_tokens"))
                    .and_then(|v| v.as_u64())
            })
        })
        .unwrap_or(0);

    // Extract cache token fields from the first chunk that has them.
    let cached_tokens = chunks
        .iter()
        .find_map(|c| {
            c.pointer("/usage/prompt_tokens_details/cached_tokens")
                .and_then(|v| v.as_u64())
        })
        .unwrap_or(0);
    let cache_write_tokens = chunks
        .iter()
        .find_map(|c| {
            c.pointer("/usage/prompt_tokens_details/cache_write_tokens")
                .and_then(|v| v.as_u64())
        })
        .unwrap_or(0);
    // Also check Anthropic-native cache fields on the upstream.
    let cache_creation_tokens = chunks
        .iter()
        .find_map(|c| {
            c.get("usage")
                .and_then(|u| u.get("cache_creation_input_tokens"))
                .and_then(|v| v.as_u64())
                .or_else(|| {
                    // Fall back to cache_write_tokens from OpenAI-style details.
                    if cache_write_tokens > 0 {
                        Some(cache_write_tokens)
                    } else {
                        None
                    }
                })
        })
        .unwrap_or(0);
    let cache_read_tokens = chunks
        .iter()
        .find_map(|c| {
            c.get("usage")
                .and_then(|u| u.get("cache_read_input_tokens"))
                .and_then(|v| v.as_u64())
                .or_else(|| {
                    // Fall back to cached_tokens from OpenAI-style details.
                    if cached_tokens > 0 {
                        Some(cached_tokens)
                    } else {
                        None
                    }
                })
        })
        .unwrap_or(0);

    // Extract stop_sequence from the last chunk if present.
    let stop_sequence_from_chunk = chunks.iter().rev().find_map(|c| {
        c.pointer("/choices/0/stop_sequence")
            .or_else(|| c.get("stop_sequence"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    });

    let mut events = String::new();

    // ── message_start ──────────────────────────────────────────────
    events.push_str(&format!(
        "event: message_start\ndata: {}\n\n",
        serde_json::to_string(&json!({
            "type": "message_start",
            "message": {
                "id": msg_id,
                "type": "message",
                "role": "assistant",
                "content": [],
                "model": model,
                "stop_reason": null,
                "stop_sequence": null,
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": 0,
                    "cache_creation_input_tokens": cache_creation_tokens,
                    "cache_read_input_tokens": cache_read_tokens
                }
            }
        }))
        .unwrap_or_default()
    ));

    // ── Emit a ping event after message_start ─────────────────────
    events.push_str("event: ping\ndata: {\"type\":\"ping\"}\n\n");

    // ── Collect deltas ─────────────────────────────────────────────
    let mut thinking_started = false;
    let mut text_started = false;
    let mut content_block_index: usize = 0;
    let mut delta_count: u32 = 0;
    // tool_call_index → (id, name, accumulated_arguments)
    let mut tool_calls: std::collections::BTreeMap<u64, (String, String, String)> =
        std::collections::BTreeMap::new();

    for chunk in &chunks {
        let Some(choices) = chunk.get("choices").and_then(|c| c.as_array()) else {
            continue;
        };
        for choice in choices {
            let Some(delta) = choice.get("delta") else {
                continue;
            };

            // ── Thinking/reasoning delta (must come before text) ──────
            let reasoning = delta
                .get("reasoning_content")
                .or_else(|| delta.get("reasoning"))
                .and_then(|v| v.as_str());
            if let Some(reasoning_text) = reasoning {
                if !reasoning_text.is_empty() {
                    if !thinking_started {
                        events.push_str(&format!(
                            "event: content_block_start\ndata: {}\n\n",
                            serde_json::to_string(&json!({
                                "type": "content_block_start",
                                "index": content_block_index,
                                "content_block": {
                                    "type": "thinking",
                                    "thinking": ""
                                }
                            }))
                            .unwrap_or_default()
                        ));
                        thinking_started = true;
                    }
                    events.push_str(&format!(
                        "event: content_block_delta\ndata: {}\n\n",
                        serde_json::to_string(&json!({
                            "type": "content_block_delta",
                            "index": content_block_index,
                            "delta": {
                                "type": "thinking_delta",
                                "thinking": reasoning_text
                            }
                        }))
                        .unwrap_or_default()
                    ));
                    delta_count += 1;
                }
            }

            // ── Text content delta ──────────────────────────────────
            if let Some(text) = delta.get("content").and_then(|c| c.as_str()) {
                if !text.is_empty() {
                    if !text_started {
                        events.push_str(&format!(
                            "event: content_block_start\ndata: {}\n\n",
                            serde_json::to_string(&json!({
                                "type": "content_block_start",
                                "index": content_block_index,
                                "content_block": {
                                    "type": "text",
                                    "text": ""
                                }
                            }))
                            .unwrap_or_default()
                        ));
                        text_started = true;
                    }
                    events.push_str(&format!(
                        "event: content_block_delta\ndata: {}\n\n",
                        serde_json::to_string(&json!({
                            "type": "content_block_delta",
                            "index": content_block_index,
                            "delta": {
                                "type": "text_delta",
                                "text": text
                            }
                        }))
                        .unwrap_or_default()
                    ));
                    delta_count += 1;
                }
            }

            // ── Tool-call delta ─────────────────────────────────────
            if let Some(tc_array) = delta.get("tool_calls").and_then(|tc| tc.as_array()) {
                for tc in tc_array {
                    let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                    let entry = tool_calls.entry(idx).or_insert_with(|| {
                        let id = tc
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("toolu_placeholder")
                            .to_string();
                        let name = tc
                            .get("function")
                            .and_then(|f| f.get("name"))
                            .and_then(|n| n.as_str())
                            .unwrap_or("")
                            .to_string();
                        (id, name, String::new())
                    });
                    if let Some(args) = tc
                        .get("function")
                        .and_then(|f| f.get("arguments"))
                        .and_then(|a| a.as_str())
                    {
                        entry.2.push_str(args);
                    }
                    delta_count += 1;
                }
            }

            // ── Periodic ping every 5 content_block_delta events ──
            if delta_count % 5 == 0 && delta_count > 0 {
                events.push_str("event: ping\ndata: {\"type\":\"ping\"}\n\n");
            }
        }
    }

    // ── Close thinking block (if started, before text) ────────────
    if thinking_started {
        events.push_str(&format!(
            "event: content_block_stop\ndata: {}\n\n",
            serde_json::to_string(&json!({
                "type": "content_block_stop",
                "index": content_block_index
            }))
            .unwrap_or_default()
        ));
        content_block_index += 1;
    }

    // ── Close text block ───────────────────────────────────────────
    if text_started {
        events.push_str(&format!(
            "event: content_block_stop\ndata: {}\n\n",
            serde_json::to_string(&json!({
                "type": "content_block_stop",
                "index": content_block_index
            }))
            .unwrap_or_default()
        ));
        content_block_index += 1;
    }

    // ── Emit tool_use content blocks ───────────────────────────────
    for (_tc_idx, (tool_id, tool_name, tool_args)) in &tool_calls {
        // content_block_start: NO input field — SDK builds it from deltas
        events.push_str(&format!(
            "event: content_block_start\ndata: {}\n\n",
            serde_json::to_string(&json!({
                "type": "content_block_start",
                "index": content_block_index,
                "content_block": {
                    "type": "tool_use",
                    "id": tool_id,
                    "name": tool_name
                }
            }))
            .unwrap_or_default()
        ));

        // Emit input_json_delta events in ~64-char chunks so the SDK can
        // accumulate the arguments incrementally.
        let chunk_size = 64;
        let mut pos = 0;
        let args_bytes = tool_args.as_bytes();
        while pos < args_bytes.len() {
            let end = std::cmp::min(pos + chunk_size, args_bytes.len());
            // Don't split a multi-byte UTF-8 character.
            let mut chunk_end = end;
            while chunk_end < args_bytes.len() && (args_bytes[chunk_end] & 0xC0) == 0x80 {
                chunk_end += 1;
            }
            let partial_json = std::str::from_utf8(&args_bytes[pos..chunk_end]).unwrap_or("");
            if !partial_json.is_empty() {
                events.push_str(&format!(
                    "event: content_block_delta\ndata: {}\n\n",
                    serde_json::to_string(&json!({
                        "type": "content_block_delta",
                        "index": content_block_index,
                        "delta": {
                            "type": "input_json_delta",
                            "partial_json": partial_json
                        }
                    }))
                    .unwrap_or_default()
                ));
            }
            pos = chunk_end;
        }

        events.push_str(&format!(
            "event: content_block_stop\ndata: {}\n\n",
            serde_json::to_string(&json!({
                "type": "content_block_stop",
                "index": content_block_index
            }))
            .unwrap_or_default()
        ));
        content_block_index += 1;
    }

    // ── message_delta ──────────────────────────────────────────────
    let (stop_reason, stop_seq) = match last_finish_reason.as_deref() {
        Some("stop") => (
            "end_turn",
            stop_sequence_from_chunk
                .map(Value::String)
                .unwrap_or(Value::Null),
        ),
        Some("length") => ("max_tokens", Value::Null),
        Some("tool_calls") => ("tool_use", Value::Null),
        Some("content_filter") => ("end_turn", Value::Null),
        Some("stop_sequence") => (
            "stop_sequence",
            stop_sequence_from_chunk
                .map(Value::String)
                .unwrap_or(Value::Null),
        ),
        _ => ("end_turn", Value::Null),
    };

    // Build usage object for message_delta: output_tokens is required,
    // input_tokens is included when available (Anthropic clients expect it).
    let mut delta_usage = json!({
        "output_tokens": output_tokens
    });
    // Include input_tokens in message_delta usage (Anthropic protocol expects it here).
    if input_tokens > 0 {
        delta_usage["input_tokens"] = json!(input_tokens);
    }
    if cache_creation_tokens > 0 {
        delta_usage["cache_creation_input_tokens"] = json!(cache_creation_tokens);
    }
    if cache_read_tokens > 0 {
        delta_usage["cache_read_input_tokens"] = json!(cache_read_tokens);
    }

    events.push_str(&format!(
        "event: message_delta\ndata: {}\n\n",
        serde_json::to_string(&json!({
            "type": "message_delta",
            "delta": {
                "stop_reason": stop_reason,
                "stop_sequence": stop_seq
            },
            "usage": delta_usage
        }))
        .unwrap_or_default()
    ));

    // ── message_stop ───────────────────────────────────────────────
    events.push_str("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");

    events
}

/// POST /v1/messages — Anthropic Messages API compatible endpoint.
///
/// Accepts an Anthropic-format request, converts it to OpenAI chat-completions,
/// forwards to the configured upstream, and translates the response back to the
/// Anthropic shape. When `stream: true`, the buffered upstream SSE is parsed and
/// re-emitted as Anthropic Messages SSE events. Non-JSON or >=400 upstream
/// responses are wrapped in the Anthropic error envelope so Claude SDK clients
/// can parse them.
async fn anthropic_messages_handler(
    AxumState(state): AxumState<ServerState>,
    headers: axum::http::HeaderMap,
    body: Result<Json<Value>, JsonRejection>,
) -> Response {
    if let Err((status, msg, err_type)) = check_auth(&state, &headers).await {
        return anthropic_error_response(status, &err_type, &msg);
    }

    let body = match anthropic_json_body_or_error(body) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let wants_stream = is_truthy(body.get("stream"));

    // Validate that messages array exists and is non-empty.
    if !body
        .get("messages")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty())
    {
        return anthropic_error_response(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "messages: field required",
        );
    }

    // Detect Anthropic upstream before converting, so we can pass the
    // original Anthropic body through directly (avoiding lossy double-conversion).
    let (chat_body, is_anthropic_upstream) = {
        let config = state.config.read().await;
        if !has_configured_upstream(&config) {
            return anthropic_error_response(
                StatusCode::BAD_REQUEST,
                "invalid_request_error",
                "API key is not configured.",
            );
        }

        // Model validation
        let model = body
            .get("model")
            .and_then(|v| v.as_str())
            .filter(|m| !m.is_empty())
            .unwrap_or(&config.selected_model)
            .to_string();

        if model != "auto" && !config.models.contains(&model) {
            return anthropic_error_response(
                StatusCode::NOT_FOUND,
                "invalid_request_error",
                &format!("The model `{}` does not exist.", model),
            );
        }

        let is_anthropic = config.accounts.iter().any(|a| {
            a.id == config.active_account_id
                && (a.provider == AccountProvider::Anthropic
                    || (a.provider == AccountProvider::Auto
                        && a.detected_protocol == Some(AccountProvider::Anthropic)))
        });
        if is_anthropic {
            (body.clone(), true)
        } else {
            (anthropic_to_openai(&body, &config), false)
        }
    };

    let model = chat_body
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let upstream_path = if is_anthropic_upstream {
        "/v1/messages"
    } else {
        "/v1/chat/completions"
    };
    let (status, _ct, resp_body) = forward_request(
        &state,
        "/v1/messages",
        upstream_path,
        "POST",
        Some(&chat_body),
    )
    .await;

    // ── Error path (all upstream failures) ─────────────────────────
    if status >= 400 {
        if let Some(entry) = state.logs.write().await.first_mut() {
            entry.model = Some(model.clone());
        }
        let msg = resp_body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| match resp_body {
                Value::String(s) => {
                    let title = extract_html_title(&s);
                    if !title.is_empty() {
                        format!("Upstream error: {title}")
                    } else if s.len() > 512 {
                        format!("{}...", &s[..512])
                    } else {
                        s.clone()
                    }
                }
                other => other.to_string(),
            });
        let etype = if status == 401 {
            "authentication_error"
        } else if status == 403 {
            "permission_error"
        } else if status == 429 {
            "rate_limit_error"
        } else if status >= 500 {
            "api_error"
        } else {
            "invalid_request_error"
        };
        let sc = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        return anthropic_error_response(sc, etype, &msg);
    }

    // ── Streaming path ─────────────────────────────────────────────
    if wants_stream {
        let sse_text = match &resp_body {
            Value::String(s) => s.clone(),
            _ => resp_body.to_string(),
        };
        let anthropic_sse = if is_anthropic_upstream {
            // Anthropic upstream returns native Anthropic SSE — pass through as-is.
            sse_text
        } else {
            openai_sse_to_anthropic_sse(&sse_text, &model)
        };
        return (
            StatusCode::OK,
            [
                (
                    axum::http::header::CONTENT_TYPE,
                    "text/event-stream".to_string(),
                ),
                (axum::http::header::CONNECTION, "keep-alive".to_string()),
            ],
            anthropic_sse,
        )
            .into_response();
    }

    // ── Non-streaming path ─────────────────────────────────────────
    if is_anthropic_upstream {
        // Response is already in Anthropic format — pass through directly.
        build_upstream_response(200, "application/json", &resp_body)
    } else {
        let anthropic_resp = openai_to_anthropic(&resp_body, &model);
        build_upstream_response(200, "application/json", &anthropic_resp)
    }
}

async fn responses_handler(
    AxumState(state): AxumState<ServerState>,
    headers: axum::http::HeaderMap,
    request_body: Result<Json<Value>, JsonRejection>,
) -> Response {
    if let Err((status, msg, err_type)) = check_auth(&state, &headers).await {
        return json_error(status, &msg, &err_type);
    }

    let request_body = match json_body_or_error(request_body) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let chat_body = {
        let config = state.config.read().await;
        if !has_configured_upstream(&config) {
            return json_error(
                StatusCode::BAD_REQUEST,
                "API key is not configured.",
                "bridge_config_error",
            );
        }
        let mut body =
            map_responses_request_to_chat(&request_body, &config, &*SESSIONS.read().await);
        apply_model_defaults(&mut body, &config);
        body
    };

    let model = extract_model(&chat_body);
    let model_str = model.clone().unwrap_or_default();
    {
        let config = state.config.read().await;
        if model_str != "auto" && !config.models.contains(&model_str) {
            return json_error(
                StatusCode::NOT_FOUND,
                &format!("The model `{}` does not exist.", model_str),
                "invalid_request_error",
            );
        }
    }

    let (status, ct, resp_body, stream_tool_items) =
        run_responses_agent_loop(&state, chat_body, &request_body).await;

    // Anything that isn't a successful JSON chat completion is relayed as-is;
    // only a real completion can be translated to the Responses shape.
    if !ct.contains("application/json") || status >= 400 {
        if status >= 400 {
            if let Some(m) = model {
                if let Some(entry) = state.logs.write().await.first_mut() {
                    entry.model = Some(m);
                }
            }
            let structured_error = ensure_structured_error(status, &resp_body);
            return build_upstream_response(status, "application/json", &structured_error);
        }
        return build_upstream_response(status, &ct, &resp_body);
    }

    let translated = map_chat_response_to_responses(&resp_body, &request_body, model.as_deref());

    store_responses_session(&request_body, &translated).await;

    // `Boolean(requestBody.stream)` is a truthiness test, not a strict bool
    // check — a client sending `1` or `"true"` still wants SSE.
    let wants_stream = is_truthy(request_body.get("stream"));

    if wants_stream {
        return build_sse_response(&translated, &stream_tool_items);
    }

    build_upstream_response(status, &ct, &translated)
}

/// Remember the conversation behind a response id so `previous_response_id`
/// can replay it. Port of `storeResponsesSession` (bridgeServer.ts:973-994).
async fn store_responses_session(request_body: &Value, translated: &Value) {
    let Some(response_id) = translated
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|id| !id.is_empty())
    else {
        return;
    };

    let current_input: Vec<Value> = request_body
        .get("input")
        .map(|input| {
            if let Some(arr) = input.as_array() {
                arr.iter().filter(|i| i.is_object()).cloned().collect()
            } else if let Some(s) = input.as_str() {
                vec![json!({"role": "user", "content": s})]
            } else {
                vec![]
            }
        })
        .unwrap_or_default();

    let output_items: Vec<Value> = translated
        .get("output")
        .and_then(|o| o.as_array())
        .map(|arr| arr.iter().filter(|i| i.is_object()).cloned().collect())
        .unwrap_or_default();

    let prev_id = request_body
        .get("previous_response_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut sessions = SESSIONS.write().await;
    let mut all_items = if prev_id.is_empty() {
        Vec::new()
    } else {
        sessions.get(prev_id).cloned().unwrap_or_default()
    };
    all_items.extend(current_input);
    all_items.extend(output_items);
    sessions.insert(response_id.to_string(), all_items);
}

// ─── Response builders ──────────────────────────────────────────────────────

fn build_upstream_response(status: u16, content_type: &str, body: &Value) -> Response {
    let sc = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    if content_type.contains("application/json") {
        (sc, Json(body.clone())).into_response()
    } else {
        let body_str = body.to_string();
        let text = body.as_str().unwrap_or(&body_str);
        (
            sc,
            [(axum::http::header::CONTENT_TYPE, content_type)],
            text.to_string(),
        )
            .into_response()
    }
}

/// Build an SSE response for the Responses streaming format.
///
/// Port of `writeResponsesStream` (bridgeServer.ts:996-1157). Two deliberate
/// deviations from the JS, both places where the original contradicts itself:
/// `sequence_number` increments in emission order (the JS numbered the trailing
/// events before building the tool events, so its stream was non-monotonic),
/// and each tool call/output pair gets its own `output_index` (the JS reused
/// `index + 1` and `index + 2`, so consecutive tool calls collided).
fn build_sse_response(response_body: &Value, tool_items: &[StreamToolItem]) -> Response {
    let id = response_body
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let object = response_body
        .get("object")
        .and_then(|v| v.as_str())
        .unwrap_or("response");
    let created_at = response_body
        .get("created_at")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let model = response_body
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let output_text = response_body
        .get("output_text")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Reuse the id of the message item already in `output` so the streamed
    // item and the final response agree; only synthesize one if it's absent.
    let item_id = response_body
        .get("output")
        .and_then(|o| o.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|item| item.get("type").and_then(|t| t.as_str()) == Some("message"))
        })
        .and_then(|item| item.get("id"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("msg_{}", Uuid::new_v4().as_simple()));

    let content_part = json!({
        "type": "output_text",
        "text": output_text,
        "annotations": [],
    });

    let mut seq: u64 = 1;
    let mut events: Vec<String> = Vec::new();

    events.push(sse_event(
        "response.created",
        &mut seq,
        json!({
            "type": "response.created",
            "response": {
                "id": id,
                "object": object,
                "created_at": created_at,
                "status": "in_progress",
                "model": model,
                "output": [],
                "usage": null,
            }
        }),
    ));

    // Locally executed tool calls, replayed before the assistant message.
    for (index, tool_item) in tool_items.iter().enumerate() {
        let call_index = 1 + 2 * index;
        let output_index = call_index + 1;

        let mut in_progress_call = tool_item.call.clone();
        in_progress_call["status"] = json!("in_progress");
        events.push(sse_event(
            "response.output_item.added",
            &mut seq,
            json!({
                "type": "response.output_item.added",
                "output_index": call_index,
                "item": in_progress_call,
            }),
        ));
        events.push(sse_event(
            "response.output_item.done",
            &mut seq,
            json!({
                "type": "response.output_item.done",
                "output_index": call_index,
                "item": tool_item.call,
            }),
        ));

        let mut in_progress_output = tool_item.output.clone();
        in_progress_output["status"] = json!("in_progress");
        in_progress_output["output"] = json!("");
        events.push(sse_event(
            "response.output_item.added",
            &mut seq,
            json!({
                "type": "response.output_item.added",
                "output_index": output_index,
                "item": in_progress_output,
            }),
        ));
        events.push(sse_event(
            "response.output_item.done",
            &mut seq,
            json!({
                "type": "response.output_item.done",
                "output_index": output_index,
                "item": tool_item.output,
            }),
        ));
    }

    events.push(sse_event(
        "response.output_item.added",
        &mut seq,
        json!({
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {
                "id": item_id,
                "type": "message",
                "status": "in_progress",
                "role": "assistant",
                "content": [],
            }
        }),
    ));

    events.push(sse_event(
        "response.content_part.added",
        &mut seq,
        json!({
            "type": "response.content_part.added",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "part": {
                "type": "output_text",
                "text": "",
                "annotations": [],
            }
        }),
    ));

    events.push(sse_event(
        "response.output_text.delta",
        &mut seq,
        json!({
            "type": "response.output_text.delta",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "delta": output_text,
        }),
    ));

    events.push(sse_event(
        "response.output_text.done",
        &mut seq,
        json!({
            "type": "response.output_text.done",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "text": output_text,
        }),
    ));

    events.push(sse_event(
        "response.content_part.done",
        &mut seq,
        json!({
            "type": "response.content_part.done",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "part": content_part,
        }),
    ));

    events.push(sse_event(
        "response.output_item.done",
        &mut seq,
        json!({
            "type": "response.output_item.done",
            "output_index": 0,
            "item": {
                "id": item_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [content_part],
            }
        }),
    ));

    let mut completed_response = response_body.clone();
    completed_response["completed_at"] = json!(Utc::now().timestamp());
    events.push(sse_event(
        "response.completed",
        &mut seq,
        json!({
            "type": "response.completed",
            "response": completed_response,
        }),
    ));

    events.push("data: [DONE]\n\n".to_string());

    (
        StatusCode::OK,
        [
            (
                axum::http::header::CONTENT_TYPE,
                "text/event-stream; charset=utf-8",
            ),
            (axum::http::header::CACHE_CONTROL, "no-cache, no-transform"),
            (axum::http::header::CONNECTION, "keep-alive"),
        ],
        events.concat(),
    )
        .into_response()
}

fn sse_event(event_type: &str, seq: &mut u64, mut data: Value) -> String {
    if let Some(map) = data.as_object_mut() {
        map.insert("sequence_number".to_string(), json!(*seq));
    }
    *seq += 1;
    format!("event: {event_type}\ndata: {data}\n\n")
}

// ─── Server lifecycle ───────────────────────────────────────────────────────

/// Restart the fixed listener and wait until the supervisor has successfully
/// rebound `127.0.0.1:48231`. Commands must not report success merely because
/// they sent a shutdown signal.
pub async fn request_rebind() -> Result<(), String> {
    if SERVER_STOPPING.load(Ordering::Acquire) {
        return Err("Sparkly API is shutting down.".to_string());
    }
    let previous_generation = SERVER_GENERATION.load(Ordering::Acquire);
    let shutdown = SHUTDOWN_TX
        .lock()
        .take()
        .ok_or_else(|| "The local API listener is not currently running.".to_string())?;
    let _ = shutdown.send(());

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    loop {
        if SERVER_STOPPING.load(Ordering::Acquire) {
            return Err("Sparkly API is shutting down.".to_string());
        }
        if SERVER_GENERATION.load(Ordering::Acquire) > previous_generation {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(
                "Timed out while restarting http://localhost:48231. Check whether another process owns port 48231."
                    .to_string(),
            );
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// Bind the listener once and serve until a rebind is requested.
///
/// Returns `Ok(())` on a graceful shutdown (rebind requested) so the supervisor
/// knows to loop; returns `Err` only when binding or serving genuinely failed.
async fn serve_once(state: Arc<AppState>) -> anyhow::Result<()> {
    let enable_cors = state.config.read().await.enable_cors;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    *SHUTDOWN_TX.lock() = Some(shutdown_tx);

    let cors_layer = if enable_cors {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        CorsLayer::new()
    };

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/stats", get(stats_handler))
        .route("/logs", get(logs_handler))
        .route("/v1", get(v1_index_handler))
        .route("/v1/models", get(v1_models_handler))
        .route("/v1/chat/completions", post(chat_completions_handler))
        .route("/v1/messages", post(anthropic_messages_handler))
        .route("/v1/responses", post(responses_handler))
        .layer(cors_layer)
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .with_state(state.clone());

    let listener = TcpListener::bind(("127.0.0.1", DEFAULT_LOCAL_PORT))
        .await
        .map_err(|error| {
            anyhow::anyhow!(
                "Cannot start Sparkly API at http://localhost:{DEFAULT_LOCAL_PORT}: {error}. Close the other process using port {DEFAULT_LOCAL_PORT} and restart Sparkly API."
            )
        })?;

    let local_base_url = format!("http://localhost:{DEFAULT_LOCAL_PORT}");

    {
        let mut stats = state.stats.write().await;
        stats.local_base_url = local_base_url.clone();
        stats.server_running = true;
    }

    SERVER_GENERATION.fetch_add(1, Ordering::Release);
    tracing::info!("Bridge server listening on {local_base_url}");

    let result = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        })
        .await;

    {
        let mut stats = state.stats.write().await;
        stats.server_running = false;
    }

    result.map_err(|e| anyhow::anyhow!("Bridge server error: {e}"))
}

/// Stop the listener supervisor during application exit.
///
/// Unlike a normal rebind, this terminal flag prevents graceful shutdown from
/// racing into a fresh bind while Tauri is tearing down.
///
///
///
///
///
pub fn shutdown_supervisor() {
    SERVER_STOPPING.store(true, Ordering::Release);
    if let Some(shutdown) = SHUTDOWN_TX.lock().take() {
        let _ = shutdown.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::{extract_models_from_response, route_is_missing, upstream_url_candidates};
    use serde_json::json;

    #[test]
    fn route_candidates_cover_versioned_and_router_shapes_without_duplicates() {
        assert_eq!(
            upstream_url_candidates("http://localhost:20128/v1", "/v1/chat/completions"),
            vec![
                "http://localhost:20128/v1/chat/completions",
                "http://localhost:20128/api/v1/chat/completions",
            ]
        );
        assert_eq!(
            upstream_url_candidates("http://localhost:20128", "/v1/responses"),
            vec![
                "http://localhost:20128/v1/responses",
                "http://localhost:20128/api/v1/responses",
            ]
        );
    }

    #[test]
    fn route_detection_never_replays_real_model_or_authentication_errors() {
        assert!(!route_is_missing(
            404,
            &json!({"error": {"code": "model_not_found", "message": "unknown model"}})
        ));
        assert!(!route_is_missing(
            404,
            &json!({"error": {"code": "authentication_error", "message": "missing key"}})
        ));
        assert!(route_is_missing(
            404,
            &json!({"error": {"message": "Cannot POST /v1/responses"}})
        ));
        assert!(route_is_missing(405, &json!({})));
    }

    #[test]
    fn model_catalog_extraction_supports_openai_and_router_payloads() {
        assert_eq!(
            extract_models_from_response(&json!({
                "models": [
                    {"alias": "qwen3.5-plus", "fullModel": "qwen/qwen3.5-plus"},
                    {"alias": "qwen3.5-plus"},
                    {"model": "claude-sonnet-4-6"}
                ]
            })),
            vec!["qwen/qwen3.5-plus", "qwen3.5-plus", "claude-sonnet-4-6"]
        );
        assert_eq!(
            extract_models_from_response(&json!({"data": [{"id": "gpt-5.4"}]})),
            vec!["gpt-5.4"]
        );
        assert_eq!(
            extract_models_from_response(&json!([{"id": "together/model"}])),
            vec!["together/model"]
        );
        assert_eq!(
            extract_models_from_response(
                &json!({"models": [{"name": "command-r"}, {"model": "llama3.2"}]})
            ),
            vec!["command-r", "llama3.2"]
        );
    }
}

/// Spawn the supervising task that keeps the bridge listening for the process
/// lifetime, including explicit rebinds to the same fixed endpoint.
pub fn spawn_supervisor(state: Arc<AppState>) {
    SERVER_STOPPING.store(false, Ordering::Release);
    tauri::async_runtime::spawn(async move {
        loop {
            if SERVER_STOPPING.load(Ordering::Acquire) {
                break;
            }
            if let Err(error) = serve_once(state.clone()).await {
                tracing::error!("Bridge listener failed: {error}");
                {
                    let mut stats = state.stats.write().await;
                    stats.local_base_url = format!("http://localhost:{DEFAULT_LOCAL_PORT}");
                    stats.server_running = false;
                }
                if SERVER_STOPPING.load(Ordering::Acquire) {
                    break;
                }
                // A fixed endpoint must never silently migrate. Retry slowly so
                // a temporarily releasing socket can recover without spinning.
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }
    });
}
