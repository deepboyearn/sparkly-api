// src-tauri/src/bridge.rs
// Axum HTTP bridge server — forwards OpenAI-compatible requests to upstream accounts.
// Port of bridgeServer.ts with failover, agent loop, and Responses API translation.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::{Arc, OnceLock};

use axum::extract::{Json, State as AxumState};
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
const MODEL_FETCH_TIMEOUT_SECS: u64 = 8;
const RESPONSES_SESSION_LIMIT: usize = 50;

// ─── Module-level singleton ─────────────────────────────────────────────────

static SHUTDOWN_TX: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);
static RESPONSES_SESSIONS: OnceLock<RwLock<HashMap<String, Vec<Value>>>> = OnceLock::new();

fn get_or_init_sessions() -> &'static RwLock<HashMap<String, Vec<Value>>> {
    RESPONSES_SESSIONS.get_or_init(|| RwLock::new(HashMap::new()))
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

/// Extract model IDs from a `/v1/models` response body.
fn extract_models_from_response(raw: &Value) -> Vec<String> {
    raw.pointer("/data")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.get("id").and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Normalize a base URL by stripping trailing slashes and `/v1` suffix.
fn normalize_base_url(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(stripped) = trimmed.strip_suffix("/v1") {
        stripped.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Check whether the config has at least one configured upstream account.
fn has_configured_upstream(config: &BridgeConfig) -> bool {
    !config.api_key.is_empty()
        || config
            .accounts
            .iter()
            .any(|a| !a.base_url.is_empty() && !a.api_key.is_empty())
}

/// Determine whether we should failover to the next account for this status/body.
fn should_failover(status: u16, body: &Value) -> bool {
    matches!(status, 401 | 402 | 403 | 429 | 500 | 502 | 503 | 504)
        || (status == 400 && failover_from_400_body(body))
}

fn failover_from_400_body(body: &Value) -> bool {
    if let Some(err) = body.get("error") {
        let code = err.get("code").and_then(|v| v.as_str()).unwrap_or("");
        let typ = err.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let msg = err.get("message").and_then(|v| v.as_str()).unwrap_or("");
        let combined = format!("{code} {typ} {msg}").to_lowercase();
        return combined.contains("quota")
            || combined.contains("insufficient")
            || combined.contains("credit")
            || combined.contains("balance")
            || combined.contains("billing")
            || combined.contains("rate limit");
    }
    false
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

/// Get the active upstream account from config (active_account_id or first).
fn get_active_account(config: &BridgeConfig) -> Option<&UpstreamAccount> {
    if !config.active_account_id.is_empty() {
        config
            .accounts
            .iter()
            .find(|a| a.id == config.active_account_id)
    } else {
        config.accounts.first()
    }
}

/// Extract the model name from a JSON request body.
fn extract_model(body: &Value) -> Option<String> {
    body.get("model")
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// Apply model defaults: inject selected_model if missing, prepend system prompt.
fn apply_model_defaults(body: &mut Value, config: &BridgeConfig) {
    if !body.get("model").is_some() || body.get("model").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        body["model"] = Value::String(config.selected_model.clone());
    }

    if !config.system_prompt.is_empty() {
        if let Some(messages) = body.get_mut("messages").and_then(|v| v.as_array_mut()) {
            let has_system = messages.iter().any(|m| {
                m.get("role")
                    .and_then(|v| v.as_str())
                    .map(|r| r == "system")
                    .unwrap_or(false)
            });
            if !has_system {
                let sys = json!({"role": "system", "content": config.system_prompt});
                messages.insert(0, sys);
            }
        }
    }
}

/// Record a request in the logs (module-level, called via AppState).
async fn record_request(
    logs: &RwLock<Vec<RequestLogEntry>>,
    stats: &RwLock<BridgeStats>,
    method: &str,
    path: &str,
    status: u16,
    model: Option<String>,
    duration_ms: u64,
    error: Option<String>,
    success: bool,
) {
    {
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

    {
        let mut s = stats.write().await;
        s.total_requests += 1;
        if success {
            s.success_count += 1;
        } else {
            s.error_count += 1;
        }
        s.last_request_at = Some(Utc::now().to_rfc3339());
    }
}

/// Mark an account as used and potentially select it as active.
async fn mark_account_used(state: &AppState, account_id: &str) {
    let mut cfg = state.config.write().await;
    let now = Utc::now().to_rfc3339();
    for acct in &mut cfg.accounts {
        if acct.id == account_id {
            acct.last_used_at = Some(now.clone());
            break;
        }
    }
    // Select as active if not already
    if cfg.active_account_id != account_id {
        cfg.active_account_id = account_id.to_string();
    }
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
            let parsed: Value =
                serde_json::from_str(raw_arguments).unwrap_or_else(|_| json!({}));
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
fn merge_conversation_input(body: &Value, sessions: &HashMap<String, Vec<Value>>) -> Value {
    let prev_id = body
        .get("previous_response_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if prev_id.is_empty() {
        return body
            .get("input")
            .cloned()
            .unwrap_or_else(|| json!([]));
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
                let name = obj
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool");
                let args = obj
                    .get("arguments")
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
                messages.push(json!({
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": args,
                        }
                    }],
                }));
            }
            continue;
        }

        // Standard role message (user/assistant/system)
        let content = map_responses_content_to_chat(
            obj.get("content").unwrap_or(&Value::Null),
        );
        messages.push(json!({"role": role, "content": content}));
    }

    if messages.is_empty() {
        vec![json!({"role": "user", "content": ""})]
    } else {
        messages
    }
}

/// Map a Responses content value to a chat-compatible content value.
fn map_responses_content_to_chat(content: &Value) -> Value {
    if let Some(s) = content.as_str() {
        return Value::String(s.to_string());
    }

    let arr = match content.as_array() {
        Some(a) => a,
        None => return Value::String(String::new()),
    };

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

            let detail = obj.get("detail").and_then(|v| v.as_str());
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
        return Value::String(String::new());
    }

    // If all parts are plain text, flatten to a string
    let has_structured = parts.iter().any(|p| {
        p.get("type")
            .and_then(|v| v.as_str())
            .map(|t| t != "text")
            .unwrap_or(false)
    });

    if !has_structured {
        let combined: String = parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        Value::String(combined)
    } else {
        Value::Array(parts)
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
            let typ = obj.get("type").and_then(|v| v.as_str())?;
            if typ != "function" {
                return None;
            }
            let name = obj.get("name").and_then(|v| v.as_str())?;
            let description = obj
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let parameters = obj
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| json!({"type": "object", "properties": {}}));
            Some(json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": parameters,
                }
            }))
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
fn map_responses_request_to_chat(body: &Value, config: &BridgeConfig, sessions: &HashMap<String, Vec<Value>>) -> Value {
    let merged_input = merge_conversation_input(body, sessions);
    let messages = normalize_responses_input(&merged_input);
    let chat_tools = map_responses_tools_to_chat(body.get("tools").unwrap_or(&Value::Null));
    let has_tools = !chat_tools.is_empty();
    let tool_choice = map_responses_tool_choice(
        body.get("tool_choice").unwrap_or(&Value::Null),
        has_tools,
    );

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

    if let Some(ptc) = body.get("parallel_tool_calls") {
        chat_body["parallel_tool_calls"] = ptc.clone();
    }

    if let Some(max) = body.get("max_output_tokens") {
        if let Some(n) = max.as_u64() {
            chat_body["max_tokens"] = Value::Number(n.into());
        }
    }

    if let Some(temp) = body.get("temperature") {
        chat_body["temperature"] = temp.clone();
    }

    chat_body
}

/// Map a chat completion response to the Responses format.
fn map_chat_response_to_responses(body: &Value, request_body: &Value, fallback_model: Option<&str>) -> Value {
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

    let response_id = chat
        .get("id")
        .and_then(|v| v.as_str())
        .map(|id| {
            if id.starts_with("resp_") {
                format!("resp_{}", &id[5..])
            } else {
                format!("resp_{id}")
            }
        })
        .unwrap_or_else(|| {
            format!("resp_{}", Uuid::new_v4().as_simple())
        });

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

    // Collect tool call outputs
    let tool_call_outputs: Vec<Value> = assistant_message
        .and_then(|m| m.get("tool_calls"))
        .and_then(|tc| tc.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|tc| {
                    let id = tc.get("id").and_then(|v| v.as_str())?;
                    let name = tc
                        .get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|n| n.as_str())?;
                    let args = tc
                        .get("function")
                        .and_then(|f| f.get("arguments"))
                        .and_then(|a| a.as_str())
                        .unwrap_or("{}");
                    Some(json!({
                        "id": id,
                        "type": "function_call",
                        "call_id": id,
                        "name": name,
                        "arguments": args,
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

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
    output.extend(tool_call_outputs);

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

    if let Some(temp) = request_body.get("temperature") {
        response["temperature"] = temp.clone();
    }

    response
}



// ─── Public API ─────────────────────────────────────────────────────────────

/// Build the BridgeState snapshot for the frontend.
pub async fn build_bridge_state(state: &AppState) -> BridgeState {
    let config = state.config.read().await.clone();
    let logs = state.logs.read().await.clone();
    let client_keys = state.client_keys.read().await.clone();
    let mut stats = state.stats.read().await.clone();
    stats.uptime_ms = state.started_at.elapsed().as_millis() as u64;
    stats.active_model_count = config.models.len();
    stats.local_base_url = {
        let s = state.stats.read().await;
        s.local_base_url.clone()
    };
    stats.server_running = {
        let s = state.stats.read().await;
        s.server_running
    };
    BridgeState {
        config,
        stats,
        logs,
        client_keys,
    }
}

/// Fetch models from a provider endpoint (used by refresh_active_account_models).
pub async fn fetch_models_from_provider(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let normalized = normalize_base_url(base_url);
    let url = format!("{normalized}/v1/models");

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(MODEL_FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models: {e}"))?;

    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read models response: {e}"))?;

    let raw: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

    Ok(extract_models_from_response(&raw))
}

/// Fetch models for the playground UI.
pub async fn fetch_playground_models(
    base_url: &str,
    api_key: &str,
) -> Result<PlaygroundModelsResult, String> {
    let normalized = normalize_base_url(base_url);
    let url = format!("{normalized}/v1/models");

    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(MODEL_FETCH_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Ok(PlaygroundModelsResult {
                ok: false,
                status: 500,
                models: vec![],
                raw: None,
                error: Some(format!("Failed to build HTTP client: {e}")),
            });
        }
    };

    match client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            let raw: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let ok = status >= 200 && status < 300;
            let models = extract_models_from_response(&raw);
            let error = if ok {
                None
            } else {
                Some(summarize_playground_failure(status, &raw, &text))
            };
            Ok(PlaygroundModelsResult {
                ok,
                status,
                models,
                raw: Some(raw),
                error,
            })
        }
        Err(e) => Ok(PlaygroundModelsResult {
            ok: false,
            status: 500,
            models: vec![],
            raw: None,
            error: Some(e.to_string()),
        }),
    }
}

/// Run a playground test request.
pub async fn playground_test(input: PlaygroundTestInput) -> Result<PlaygroundTestResult, String> {
    let normalized = normalize_base_url(&input.base_url);
    let url = format!("{normalized}/v1/chat/completions");

    let mut messages = Vec::new();
    if let Some(sp) = &input.system_prompt {
        if !sp.is_empty() {
            messages.push(json!({"role": "system", "content": sp}));
        }
    }
    messages.push(json!({"role": "user", "content": input.message}));

    let body = json!({
        "model": input.model,
        "messages": messages,
        "max_tokens": 300,
    });

    let client = match Client::builder()
        .timeout(std::time::Duration::from_secs(PLAYGROUND_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Ok(PlaygroundTestResult {
                ok: false,
                status: 500,
                model: Some(input.model),
                content: None,
                raw: None,
                error: Some(format!("Failed to build HTTP client: {e}")),
            });
        }
    };

    match client
        .post(&url)
        .header("Authorization", format!("Bearer {}", input.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            let raw: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let ok = status >= 200 && status < 300;

            let content = if ok {
                raw.pointer("/choices/0/message/content")
                    .and_then(|c| c.as_str())
                    .map(String::from)
            } else {
                Some(summarize_playground_failure(status, &raw, &text))
            };

            let error = if ok {
                None
            } else {
                content.clone().or_else(|| Some("Request failed".to_string()))
            };

            Ok(PlaygroundTestResult {
                ok,
                status,
                model: Some(input.model),
                content,
                raw: Some(raw),
                error,
            })
        }
        Err(e) => Ok(PlaygroundTestResult {
            ok: false,
            status: 500,
            model: Some(input.model),
            content: None,
            raw: None,
            error: Some(e.to_string()),
        }),
    }
}

// ─── Upstream forwarding with failover ──────────────────────────────────────

/// Forward a request through the failover chain.
/// Returns (status, content_type, body).
async fn forward_request(
    state: &AppState,
    upstream_path: &str,
    method: &str,
    body: Option<&Value>,
) -> (u16, String, Value) {
    let config = state.config.read().await.clone();
    let started = std::time::Instant::now();

    // Build ordered account list: active first, then the rest
    let accounts = {
        let mut list: Vec<UpstreamAccount> = Vec::new();
        if let Some(active) = get_active_account(&config) {
            list.push(active.clone());
            for acct in &config.accounts {
                if acct.id != active.id {
                    list.push(acct.clone());
                }
            }
        } else {
            list = config.accounts.clone();
        }
        list
    };

    let model = body.and_then(extract_model);

    for account in &accounts {
        // Skip accounts without credentials
        if account.api_key.is_empty() || account.base_url.is_empty() {
            continue;
        }

        let result = if account.provider == AccountProvider::V0 {
            forward_v0_request(account, upstream_path, method, body).await
        } else {
            forward_openai_compatible_request(account, upstream_path, method, body).await
        };

        match result {
            Ok((status, ct, resp_body)) => {
                let duration = started.elapsed().as_millis() as u64;
                let is_success = status >= 200 && status < 300;

                record_request(
                    &state.logs,
                    &state.stats,
                    method,
                    upstream_path,
                    status,
                    model.clone(),
                    duration,
                    None,
                    is_success,
                )
                .await;

                if is_success {
                    mark_account_used(state, &account.id).await;
                    return (status, ct, resp_body);
                }

                let should_failover = should_failover(status, &resp_body);
                let is_last = account.id == accounts.last().map(|a| a.id.as_str()).unwrap_or("");

                if !should_failover || is_last {
                    return (status, ct, resp_body);
                }
                // Continue to next account
            }
            Err(e) => {
                let is_last = account.id == accounts.last().map(|a| a.id.as_str()).unwrap_or("");
                if is_last {
                    let duration = started.elapsed().as_millis() as u64;
                    record_request(
                        &state.logs,
                        &state.stats,
                        method,
                        upstream_path,
                        502,
                        model.clone(),
                        duration,
                        Some(e.clone()),
                        false,
                    )
                    .await;
                    return (
                        502,
                        "application/json".into(),
                        json!({"error": {"message": e, "type": "bridge_upstream_error"}}),
                    );
                }
                // Try next account
            }
        }
    }

    (
        400,
        "application/json".into(),
        json!({"error": {"message": "No configured upstream accounts are available.", "type": "bridge_account_error"}}),
    )
}

/// Forward to an OpenAI-compatible provider.
async fn forward_openai_compatible_request(
    account: &UpstreamAccount,
    upstream_path: &str,
    method: &str,
    body: Option<&Value>,
) -> Result<(u16, String, Value), String> {
    let url = format!("{}{upstream_path}", account.base_url);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(UPSTREAM_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Failed to build client: {e}"))?;

    let mut req = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };

    req = req
        .header("Authorization", format!("Bearer {}", account.api_key))
        .header("Content-Type", "application/json");

    if let Some(b) = body {
        req = req.json(b);
    }

    let resp = req.send().await.map_err(|e| format!("Upstream request failed: {e}"))?;
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();

    let text = resp.text().await.map_err(|e| format!("Failed to read response: {e}"))?;

    // Handle redirects manually — don't follow, return as-is
    if status >= 300 && status < 400 {
        return Ok((
            status,
            content_type,
            json!({"error": {"message": "Redirect received", "type": "bridge_redirect", "location": text}}),
        ));
    }

    let parsed: Value = if content_type.contains("application/json") && !text.is_empty() {
        serde_json::from_str(&text).unwrap_or(Value::String(text.clone()))
    } else {
        Value::String(text)
    };

    Ok((status, content_type, parsed))
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

    // Extract message text from chat messages
    let message = request_body
        .get("messages")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|msg| {
                    let role = msg
                        .get("role")
                        .and_then(|r| r.as_str())
                        .unwrap_or("user");
                    let content = msg
                        .get("content")
                        .map(|c| {
                            if let Some(s) = c.as_str() {
                                s.to_string()
                            } else {
                                c.to_string()
                            }
                        })
                        .unwrap_or_default();
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

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(UPSTREAM_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to build client: {e}"))?;

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

    // Map v0 response to OpenAI chat format
    let chat_text = raw
        .get("text")
        .and_then(|t| t.as_str())
        .or_else(|| {
            raw.get("latestVersion")
                .and_then(|lv| lv.get("text"))
                .and_then(|t| t.as_str())
        })
        .unwrap_or("v0 completed the request.");

    let mut lines = vec![chat_text.to_string()];
    if let Some(url) = raw.get("webUrl").and_then(|u| u.as_str()) {
        if !url.trim().is_empty() {
            lines.push(format!("\nChat URL: {}", url.trim()));
        }
    }
    if let Some(files) = raw.pointer("/latestVersion/files").and_then(|f| f.as_array()) {
        let names: Vec<String> = files
            .iter()
            .filter_map(|f| f.get("name").and_then(|n| n.as_str()).map(String::from))
            .take(20)
            .collect();
        if !names.is_empty() {
            lines.push(format!(
                "\nGenerated files:\n{}",
                names.iter().map(|n| format!("- {n}")).collect::<Vec<_>>().join("\n")
            ));
        }
    }

    let content = lines.join("");
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

// ─── Agent loop for Responses API ───────────────────────────────────────────

/// Run the agent loop: forward to chat, execute local tools, repeat.
async fn run_responses_agent_loop(
    state: &AppState,
    initial_chat_body: Value,
    request_body: &Value,
    sessions: &RwLock<HashMap<String, Vec<Value>>>,
) -> (u16, String, Value) {
    let mut chat_body = initial_chat_body.clone();
    let mut accumulated_items: Vec<Value> = merge_conversation_input(request_body, &*sessions.read().await)
        .as_array()
        .cloned()
        .unwrap_or_default();

    for _turn in 0..MAX_AGENT_TURNS {
        let proxied = forward_request(state, "/v1/chat/completions", "POST", Some(&chat_body)).await;

        let is_json = proxied.1.contains("application/json");
        let is_success = proxied.0 >= 200 && proxied.0 < 300;

        if !is_json || !is_success {
            return proxied;
        }

        // Check for tool calls
        let response_message = proxied
            .2
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
            return proxied;
        }

        // Check if any local tool names are supported
        let available_tools = request_body
            .get("tools")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        let supports_local = available_tools.iter().any(|tool| {
            let name = tool
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            is_shell_tool_name(name) || is_file_tool_name(name)
        });

        if !supports_local {
            return proxied;
        }

        // Execute each tool call locally
        let mut tool_outputs: Vec<Value> = Vec::new();
        let mut tool_output_items: Vec<Value> = Vec::new();
        let mut fatal_tool_error = false;

        for tc in &tool_calls {
            let tool_name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let tc_id = tc.get("id").and_then(|i| i.as_str()).unwrap_or("");
            let args = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .unwrap_or("{}");

            if tc_id.is_empty() {
                continue;
            }

            if is_shell_tool_name(tool_name) || is_file_tool_name(tool_name) {
                let (result, fatal) = execute_tool_call(tool_name, args).await;
                if fatal {
                    fatal_tool_error = true;
                }
                tool_outputs.push(json!({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": serde_json::to_string(&result).unwrap_or_default(),
                }));
                tool_output_items.push(json!({
                    "type": "function_call_output",
                    "call_id": tc_id,
                    "output": serde_json::to_string(&result).unwrap_or_default(),
                }));
            }
        }

        if tool_outputs.is_empty() || fatal_tool_error {
            return proxied;
        }

        // Append accumulated items
        let assistant_tool_items: Vec<Value> = tool_calls
            .iter()
            .map(|tc| {
                json!({
                    "type": "function_call",
                    "id": tc.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                    "call_id": tc.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                    "name": tc.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()).unwrap_or("tool"),
                    "arguments": tc.get("function").and_then(|f| f.get("arguments")).and_then(|a| a.as_str()).unwrap_or("{}"),
                })
            })
            .collect();

        accumulated_items.extend(assistant_tool_items);
        accumulated_items.extend(tool_output_items.clone());

        // Build next chat body with appended messages
        let assistant_message = json!({
            "role": "assistant",
            "content": response_message.and_then(|m| m.get("content")).and_then(|c| c.as_str()).unwrap_or(""),
            "tool_calls": tool_calls,
        });

        // Convert tool_output_items to chat format
        let tool_chat_messages: Vec<Value> = tool_output_items
            .iter()
            .map(|item| {
                json!({
                    "role": "tool",
                    "tool_call_id": item.get("call_id").and_then(|v| v.as_str()).unwrap_or(""),
                    "content": item.get("output").and_then(|v| v.as_str()).unwrap_or(""),
                })
            })
            .collect();

        let mut messages = chat_body
            .get("messages")
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();
        messages.push(assistant_message);
        messages.extend(tool_chat_messages);

        chat_body["messages"] = Value::Array(messages);
    }

    // Exceeded max turns
    (
        400,
        "application/json".into(),
        json!({"error": {
            "message": "Agent loop exceeded maximum shell tool turns.",
            "type": "bridge_agent_loop_error",
        }}),
    )
}

// ─── axum Handlers ──────────────────────────────────────────────────────────

type ServerState = Arc<AppState>;

async fn health_handler(AxumState(state): AxumState<ServerState>) -> Json<Value> {
    let config = state.config.read().await;
    let stats = state.stats.read().await;
    Json(json!({
        "ok": true,
        "upstreamBaseUrl": config.upstream_base_url,
        "localBaseUrl": stats.local_base_url,
        "modelCount": config.models.len(),
    }))
}

async fn stats_handler(AxumState(state): AxumState<ServerState>) -> Json<Value> {
    let mut stats = state.stats.read().await.clone();
    stats.uptime_ms = state.started_at.elapsed().as_millis() as u64;
    stats.active_model_count = state.config.read().await.models.len();
    Json(serde_json::to_value(&stats).unwrap_or(json!({})))
}

async fn logs_handler(AxumState(state): AxumState<ServerState>) -> Json<Value> {
    let logs = state.logs.read().await.clone();
    Json(json!({"data": logs}))
}

async fn v1_index_handler() -> Response {
    json_error(StatusCode::NOT_FOUND, "Not Found", "bridge_not_found")
}

async fn v1_models_handler(AxumState(state): AxumState<ServerState>) -> Response {
    let config = state.config.read().await;
    if !has_configured_upstream(&config) {
        return json_error(
            StatusCode::BAD_REQUEST,
            "API key is not configured.",
            "bridge_config_error",
        );
    }
    drop(config);

    let (status, ct, body) = forward_request(&state, "/v1/models", "GET", None).await;
    build_upstream_response(status, &ct, &body)
}

async fn chat_completions_handler(
    AxumState(state): AxumState<ServerState>,
    Json(mut body): Json<Value>,
) -> Response {
    {
        let config = state.config.read().await;
        if !has_configured_upstream(&config) {
            return json_error(
                StatusCode::BAD_REQUEST,
                "API key is not configured.",
                "bridge_config_error",
            );
        }
        apply_model_defaults(&mut body, &config);
    }

    let model = extract_model(&body);
    let (status, ct, resp_body) =
        forward_request(&state, "/v1/chat/completions", "POST", Some(&body)).await;
    let response = build_upstream_response(status, &ct, &resp_body);

    // Attach model to most-recent log entry for error cases
    if status >= 400 {
        if let Some(m) = model {
            let mut logs = state.logs.write().await;
            if let Some(entry) = logs.first_mut() {
                entry.model = Some(m);
            }
        }
    }

    response
}

async fn responses_handler(
    AxumState(state): AxumState<ServerState>,
    Json(request_body): Json<Value>,
) -> Response {
    {
        let config = state.config.read().await;
        if !has_configured_upstream(&config) {
            return json_error(
                StatusCode::BAD_REQUEST,
                "API key is not configured.",
                "bridge_config_error",
            );
        }
    }

    let chat_body = {
        let config = state.config.read().await;
        let mut body = map_responses_request_to_chat(&request_body, &config, &*get_or_init_sessions().read().await);
        apply_model_defaults(&mut body, &config);
        body
    };

    let (status, ct, resp_body) =
        run_responses_agent_loop(&state, chat_body.clone(), &request_body, get_or_init_sessions()).await;

    let is_json = ct.contains("application/json");
    let is_success = status >= 200 && status < 400;

    if is_json && is_success {
        let model = extract_model(&chat_body);
        let translated =
            map_chat_response_to_responses(&resp_body, &request_body, model.as_deref());

        // Store session
        {
            let response_id = translated
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let mut sessions = get_or_init_sessions().write().await;

            // Collect input items
            let current_input = request_body
                .get("input")
                .map(|input| {
                    if let Some(arr) = input.as_array() {
                        arr.iter()
                            .filter(|i| i.is_object())
                            .cloned()
                            .collect::<Vec<_>>()
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
                .map(|arr| {
                    arr.iter()
                        .filter(|i| i.is_object())
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();

            let prev_id = request_body
                .get("previous_response_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let previous_items = if !prev_id.is_empty() {
                sessions.get(prev_id).cloned().unwrap_or_default()
            } else {
                vec![]
            };

            let mut all_items = previous_items;
            all_items.extend(current_input);
            all_items.extend(output_items);

            if !response_id.is_empty() {
                sessions.insert(response_id, all_items);
            }

            // Evict oldest if over limit
            if sessions.len() > RESPONSES_SESSION_LIMIT {
                if let Some(oldest) = sessions.keys().next().cloned() {
                    sessions.remove(&oldest);
                }
            }
        }

        let wants_stream = request_body
            .get("stream")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if wants_stream {
            return build_sse_response(&translated);
        }

        return build_upstream_response(status, &ct, &translated);
    }

    build_upstream_response(status, &ct, &resp_body)
}

// ─── Response builders ──────────────────────────────────────────────────────

fn build_upstream_response(status: u16, content_type: &str, body: &Value) -> Response {
    let sc = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    if content_type.contains("application/json") {
        (sc, Json(body.clone())).into_response()
    } else {
        let body_str = body.to_string();
        let text = body.as_str().unwrap_or(&body_str);
        (sc, [(axum::http::header::CONTENT_TYPE, content_type)], text.to_string()).into_response()
    }
}

/// Build an SSE response for the Responses streaming format.
fn build_sse_response(response_body: &Value) -> Response {
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

    let item_id = format!("msg_{}", Uuid::new_v4().as_simple());
    let mut seq: u64 = 1;

    let mut events: Vec<String> = Vec::new();

    // response.created
    events.push(sse_event(
        "response.created",
        &mut seq,
        &json!({
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

    // response.output_item.added (message)
    events.push(sse_event(
        "response.output_item.added",
        &mut seq,
        &json!({
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

    // response.content_part.added
    events.push(sse_event(
        "response.content_part.added",
        &mut seq,
        &json!({
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

    // response.output_text.delta
    events.push(sse_event(
        "response.output_text.delta",
        &mut seq,
        &json!({
            "type": "response.output_text.delta",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "delta": output_text,
        }),
    ));

    // response.output_text.done
    events.push(sse_event(
        "response.output_text.done",
        &mut seq,
        &json!({
            "type": "response.output_text.done",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "text": output_text,
        }),
    ));

    // response.content_part.done
    events.push(sse_event(
        "response.content_part.done",
        &mut seq,
        &json!({
            "type": "response.content_part.done",
            "item_id": item_id,
            "output_index": 0,
            "content_index": 0,
            "part": {
                "type": "output_text",
                "text": output_text,
                "annotations": [],
            }
        }),
    ));

    // response.output_item.done (message)
    events.push(sse_event(
        "response.output_item.done",
        &mut seq,
        &json!({
            "type": "response.output_item.done",
            "output_index": 0,
            "item": {
                "id": item_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{
                    "type": "output_text",
                    "text": output_text,
                    "annotations": [],
                }],
            }
        }),
    ));

    // response.completed
    let mut completed_response = response_body.clone();
    completed_response["completed_at"] = json!(Utc::now().timestamp() as u64);
    events.push(sse_event(
        "response.completed",
        &mut seq,
        &json!({
            "type": "response.completed",
            "response": completed_response,
        }),
    ));

    // [DONE]
    events.push("data: [DONE]\n\n".to_string());

    let body = events.join("");

    (
        StatusCode::OK,
        [
            (axum::http::header::CONTENT_TYPE, "text/event-stream; charset=utf-8"),
            (axum::http::header::CACHE_CONTROL, "no-cache, no-transform"),
            (axum::http::header::CONNECTION, "keep-alive"),
        ],
        body,
    )
        .into_response()
}

fn sse_event(event_type: &str, seq: &mut u64, data: &Value) -> String {
    let num = *seq;
    *seq += 1;
    let mut obj = data.clone();
    if let Some(map) = obj.as_object_mut() {
        map.insert("sequence_number".to_string(), json!(num));
    }
    format!("event: {event_type}\ndata: {}\n\n", obj)
}

// ─── Server lifecycle ───────────────────────────────────────────────────────

/// Start the bridge HTTP server. Blocks until shutdown signal.
pub async fn start_bridge_server(state: Arc<AppState>) -> anyhow::Result<()> {
    let config = state.config.read().await.clone();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // Store shutdown sender for restart
    *SHUTDOWN_TX.lock().unwrap() = Some(shutdown_tx);

    let local_base_url;
    let cors_layer = if config.enable_cors {
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
        .route("/v1/responses", post(responses_handler))
        .layer(cors_layer)
        .with_state(state.clone());

    // Try configured port, fallback to 0 (OS-assigned)
    let port = config.local_port;
    let listener = match TcpListener::bind(format!("127.0.0.1:{port}")).await {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            tracing::warn!("Port {port} in use, trying port 0");
            TcpListener::bind("127.0.0.1:0").await?
        }
        Err(e) => return Err(e.into()),
    };

    let addr = listener.local_addr()?;
    local_base_url = format!("http://localhost:{}", addr.port());

    // Update stats
    {
        let mut stats = state.stats.write().await;
        stats.local_base_url = local_base_url.clone();
        stats.server_running = true;
    }

    tracing::info!("Bridge server listening on {local_base_url}");

    // Run the server until shutdown
    let result = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        })
        .await;

    // Mark server stopped
    {
        let mut stats = state.stats.write().await;
        stats.server_running = false;
    }

    result.map_err(|e| anyhow::anyhow!("Bridge server error: {e}"))
}

/// Restart the bridge server (shutdown + re-bind).
pub async fn restart() -> anyhow::Result<()> {
    if let Some(tx) = SHUTDOWN_TX.lock().unwrap().take() {
        let _ = tx.send(());
    }
    Ok(())
}
