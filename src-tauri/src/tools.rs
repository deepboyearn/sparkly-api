// src-tauri/src/tools.rs
// Local tool execution — shell commands and file tools with workspace containment.

use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

// ─── Constants ───────────────────────────────────────────────────────────────

pub const MAX_AGENT_TURNS: usize = 5;
pub const MAX_TOOL_CALL_RETRIES: usize = 2;

const SHELL_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_READ_FILE_BYTES: usize = 10 * 1024 * 1024; // 10 MB
const MAX_BUFFER_BYTES: usize = 1024 * 1024; // 1 MB stdout+stderr cap

// ─── Result Type ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ToolCallResult {
    pub role: String,
    pub tool_call_id: String,
    pub content: String,
    pub is_fatal: bool,
}

// ─── Classification ──────────────────────────────────────────────────────────

/// Returns true for tool names the bridge recognises as shell/exec commands
/// (case-insensitive): shell, run_command, terminal, execute_command.
pub fn is_shell_tool_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "shell" | "run_command" | "terminal" | "execute_command"
    )
}

/// Returns true for tool names the bridge recognises as file operations
/// (case-insensitive): read_file, write_file, create_file, edit_file,
/// append_file.
pub fn is_file_tool_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "read_file" | "write_file" | "create_file" | "edit_file" | "append_file"
    )
}

// ─── Command Extraction ──────────────────────────────────────────────────────

/// Pulls the shell command string out of a tool-call arguments JSON blob.
/// Checks `command`, `cmd`, `input`, and `script` fields in that order.
pub fn extract_shell_command(arguments_str: &str) -> String {
    let parsed: Result<Value, _> = serde_json::from_str(arguments_str);
    match parsed {
        Ok(Value::Object(map)) => {
            for key in &["command", "cmd", "input", "script"] {
                if let Some(Value::String(s)) = map.get(*key) {
                    if !s.trim().is_empty() {
                        return s.clone();
                    }
                }
            }
            String::new()
        }
        _ => arguments_str.to_owned(),
    }
}

// ─── Workspace Root ──────────────────────────────────────────────────────────

/// Returns the sandbox root for file tools, creating it if missing.
///
/// **Security:** deliberately NOT `std::env::current_dir()` — the sandbox must
/// be a fixed, dedicated directory so the boundary cannot shift with the
/// process launch location.
pub fn workspace_root() -> PathBuf {
    let base = std::env::var("SPARKLY_WORKSPACE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            home::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".local/share/com.sparklyapi.sparklyapi/workspace")
        });
    std::fs::create_dir_all(&base).ok();
    base
}

// ─── Workspace Path Resolution ───────────────────────────────────────────────

/// Resolves a user-supplied path relative to `workspace_root`.
///
/// **Security:** The candidate is `canonicalize`d and must remain within the
/// workspace root.  Symlinks that escape the workspace are rejected.
pub fn resolve_workspace_path(input: &str, workspace_root: &str) -> Result<PathBuf> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        bail!("Empty file path.");
    }

    let root = Path::new(workspace_root);
    let candidate = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        root.join(trimmed)
    };

    // Canonicalize both sides so symlinks cannot escape the workspace.
    let canon_root =
        std::fs::canonicalize(root).context("Failed to canonicalize workspace root")?;
    let canon_candidate = std::fs::canonicalize(&candidate)
        .with_context(|| format!("Failed to resolve path: {}", candidate.display(),))?;

    if !canon_candidate.starts_with(&canon_root) {
        bail!(
            "File path is outside the sparkly workspace root: {}",
            candidate.display(),
        );
    }

    Ok(canon_candidate)
}

// ─── Shell Execution ─────────────────────────────────────────────────────────

/// Executes a shell command asynchronously with a 30-second timeout.
///
/// Uses `sh -c` on Unix and `cmd /c` on Windows.  Retries up to
/// [`MAX_TOOL_CALL_RETRIES`] times on timeout or buffer overflow.
pub async fn execute_shell_command(command: &str, workspace_root: &str) -> ToolCallResult {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return tool_result("NO_COMMAND", "No shell command provided.", 1, "");
    }

    let mut last_error: Option<serde_json::Value> = None;

    for attempt in 0..=MAX_TOOL_CALL_RETRIES {
        let result = run_shell_once(trimmed, workspace_root).await;

        match result {
            Ok(mut output) => {
                output["attempts"] = Value::from((attempt + 1) as u64);
                let is_fatal = output["fatal"].as_bool().unwrap_or(false);
                return ToolCallResult {
                    role: "tool".into(),
                    tool_call_id: String::new(),
                    content: output.to_string(),
                    is_fatal,
                };
            }
            Err(err_val) => {
                let code = err_val["code"].as_str().unwrap_or("UNKNOWN_TOOL_ERROR");
                let retryable = is_retryable_tool_error(code);

                if retryable && attempt < MAX_TOOL_CALL_RETRIES {
                    last_error = Some(err_val);
                    continue;
                }

                let mut val = err_val;
                val["attempts"] = Value::from((attempt + 1) as u64);
                let is_fatal = val["fatal"].as_bool().unwrap_or(false);
                return ToolCallResult {
                    role: "tool".into(),
                    tool_call_id: String::new(),
                    content: val.to_string(),
                    is_fatal,
                };
            }
        }
    }

    // Should never be reached (loop always returns), but be defensive.
    let fallback = last_error.unwrap_or_else(|| {
        error_result(
            "UNKNOWN_SHELL_ERROR",
            "Shell command failed after retries.",
            1,
        )
    });
    let is_fatal = fallback["fatal"].as_bool().unwrap_or(false);
    ToolCallResult {
        role: "tool".into(),
        tool_call_id: String::new(),
        content: fallback.to_string(),
        is_fatal,
    }
}

async fn run_shell_once(
    command: &str,
    workspace_root: &str,
) -> Result<serde_json::Value, serde_json::Value> {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };

    cmd.current_dir(workspace_root);

    let output = timeout(SHELL_TIMEOUT, cmd.output())
        .await
        .map_err(|_| {
            error_result(
                "ETIMEDOUT",
                &format!(
                    "Shell command timed out after {}s.",
                    SHELL_TIMEOUT.as_secs()
                ),
                1,
            )
        })?
        .map_err(|e| {
            error_result(
                &format!("EXIT_{}", e.raw_os_error().unwrap_or(1)),
                &format!("Failed to execute shell process: {e}"),
                e.raw_os_error().unwrap_or(1),
            )
        })?;

    let stdout = truncate_vec(&output.stdout, MAX_BUFFER_BYTES);
    let stderr = truncate_vec(&output.stderr, MAX_BUFFER_BYTES);

    if output.status.success() {
        Ok(serde_json::json!({
            "ok": true,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": 0,
        }))
    } else {
        let exit_code = output.status.code().unwrap_or(1);
        let code = format!("EXIT_{exit_code}");

        // Check for buffer overflow signal in stderr text.
        let combined = format!("{stdout}{stderr}");
        let detected = if combined.contains("maxbuffer") || combined.contains("E2BIG") {
            "EMAXBUFFER".to_string()
        } else {
            code
        };

        Err(error_result(
            &detected,
            if stderr.is_empty() {
                "Command produced no output."
            } else {
                &stderr
            },
            exit_code,
        ))
    }
}

// ─── File Tool Execution ─────────────────────────────────────────────────────

/// Dispatches a file tool call to the appropriate async handler.
pub async fn execute_file_tool(
    tool_name: &str,
    arguments: &Value,
    workspace_root: &str,
) -> ToolCallResult {
    let raw_path = arguments
        .get("path")
        .or_else(|| arguments.get("file_path"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let target_path = match resolve_workspace_path(raw_path, workspace_root) {
        Ok(p) => p,
        Err(e) => {
            return tool_result("INVALID_PATH", &e.to_string(), 1, "");
        }
    };

    let result = match tool_name.to_ascii_lowercase().as_str() {
        "read_file" => handle_read_file(&target_path).await,
        "write_file" | "create_file" => handle_write_file(arguments, &target_path).await,
        "append_file" => handle_append_file(arguments, &target_path).await,
        "edit_file" => handle_edit_file(arguments, &target_path).await,
        _ => error_result(
            "UNSUPPORTED_FILE_TOOL",
            &format!("Unsupported file tool: {tool_name}"),
            1,
        ),
    };

    let is_fatal = result["fatal"].as_bool().unwrap_or(false);
    ToolCallResult {
        role: "tool".into(),
        tool_call_id: String::new(),
        content: result.to_string(),
        is_fatal,
    }
}

async fn handle_read_file(path: &Path) -> serde_json::Value {
    // Check size before reading to avoid blowing up memory.
    let meta = match fs::metadata(path).await {
        Ok(m) => m,
        Err(e) => {
            return error_result(
                &classify_io_error(&e),
                &format!("Cannot read file metadata: {e}"),
                1,
            );
        }
    };

    if meta.len() as usize > MAX_READ_FILE_BYTES {
        return error_result(
            "FILE_TOO_LARGE",
            &format!(
                "File is {} bytes; the limit is {MAX_READ_FILE_BYTES} bytes (10 MB).",
                meta.len()
            ),
            1,
        );
    }

    match fs::read_to_string(path).await {
        Ok(content) => serde_json::json!({
            "ok": true,
            "path": path.display().to_string(),
            "content": content,
        }),
        Err(e) => error_result(
            &classify_io_error(&e),
            &format!("Failed to read file: {e}"),
            1,
        ),
    }
}

async fn handle_write_file(arguments: &Value, path: &Path) -> serde_json::Value {
    let content = arguments
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Ensure parent directory exists.
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
            return error_result(
                &classify_io_error(&e),
                &format!("Failed to create parent directory: {e}"),
                1,
            );
        }
    }

    match fs::write(path, content).await {
        Ok(()) => serde_json::json!({
            "ok": true,
            "path": path.display().to_string(),
            "written": true,
        }),
        Err(e) => error_result(
            &classify_io_error(&e),
            &format!("Failed to write file: {e}"),
            1,
        ),
    }
}

async fn handle_append_file(arguments: &Value, path: &Path) -> serde_json::Value {
    use tokio::io::AsyncWriteExt;

    let content = arguments
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Ensure parent directory exists.
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
            return error_result(
                &classify_io_error(&e),
                &format!("Failed to create parent directory: {e}"),
                1,
            );
        }
    }

    match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
    {
        Ok(mut file) => match file.write_all(content.as_bytes()).await {
            Ok(()) => serde_json::json!({
                "ok": true,
                "path": path.display().to_string(),
                "appended": true,
            }),
            Err(e) => error_result(
                &classify_io_error(&e),
                &format!("Failed to append to file: {e}"),
                1,
            ),
        },
        Err(e) => error_result(
            &classify_io_error(&e),
            &format!("Failed to open file for append: {e}"),
            1,
        ),
    }
}

/// Replaces **all** occurrences of `search` with `replace` in the file.
async fn handle_edit_file(arguments: &Value, path: &Path) -> serde_json::Value {
    let search = arguments
        .get("search")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let replace = arguments
        .get("replace")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if search.is_empty() {
        return error_result("MISSING_SEARCH", "Missing search text for edit_file.", 1);
    }

    let content = match fs::read_to_string(path).await {
        Ok(c) => c,
        Err(e) => {
            return error_result(
                &classify_io_error(&e),
                &format!("Failed to read file for editing: {e}"),
                1,
            );
        }
    };

    if !content.contains(search) {
        return error_result("SEARCH_NOT_FOUND", "Search text not found in file.", 1);
    }

    let new_content = content.replace(search, replace);

    match fs::write(path, new_content).await {
        Ok(()) => serde_json::json!({
            "ok": true,
            "path": path.display().to_string(),
            "edited": true,
        }),
        Err(e) => error_result(
            &classify_io_error(&e),
            &format!("Failed to write edited file: {e}"),
            1,
        ),
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn error_result(code: &str, message: &str, exit_code: i32) -> serde_json::Value {
    serde_json::json!({
        "ok": false,
        "stderr": message,
        "exit_code": exit_code,
        "code": code,
        "retryable": false,
    })
}

/// Wraps a raw tool result into a [`ToolCallResult`].
///
/// `tool_call_id` defaults to empty — the caller must set it.
fn tool_result(code: &str, message: &str, exit_code: i32, tool_call_id: &str) -> ToolCallResult {
    let val = error_result(code, message, exit_code);
    ToolCallResult {
        role: "tool".into(),
        tool_call_id: tool_call_id.to_owned(),
        content: val.to_string(),
        is_fatal: false,
    }
}

fn classify_io_error(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => "ENOENT".into(),
        std::io::ErrorKind::PermissionDenied => "EPERM".into(),
        std::io::ErrorKind::AlreadyExists => "EEXIST".into(),
        std::io::ErrorKind::InvalidData => "INVALID_DATA".into(),
        _ => format!("IO_{}", e.raw_os_error().unwrap_or(0)),
    }
}

fn is_retryable_tool_error(code: &str) -> bool {
    matches!(code, "ETIMEDOUT" | "EMAXBUFFER")
}

/// Truncates a byte vector to `max` bytes, appending an ellipsis marker when
/// truncated.
fn truncate_vec(bytes: &[u8], max: usize) -> String {
    let truncated = if bytes.len() > max {
        &bytes[..max]
    } else {
        bytes
    };
    let mut s = String::from_utf8_lossy(truncated).into_owned();
    if bytes.len() > max {
        s.push_str("\n… [truncated]");
    }
    s
}
