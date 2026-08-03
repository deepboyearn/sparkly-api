// model_mapper.rs — Maps Antigravity model names to Sparkly API upstream model IDs
//
// When Antigravity sends a request with "Gemini 3.6 Flash (High)", the MITM
// handler rewrites it to whatever model ID the upstream provider expects
// (e.g., "google/gemini-3.5-flash" for OpenRouter, "deepseek-chat" for DeepSeek).

use std::collections::HashMap;

/// Default model mappings for Antigravity models.
/// These can be overridden by the user in the dashboard.
pub fn default_mappings() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("Gemini 3.6 Flash (High)".into(), "gemini-3.6-flash".into());
    m.insert("Gemini 3.6 Flash (Medium)".into(), "gemini-3.6-flash".into());
    m.insert("Gemini 3.6 Flash (Low)".into(), "gemini-3.6-flash".into());
    m.insert("Gemini 3.5 Flash (Medium) / Default".into(), "gemini-3.5-flash".into());
    m.insert("Gemini 3.5 Flash (High)".into(), "gemini-3.5-flash".into());
    m.insert("Gemini 3.5 Flash (Low)".into(), "gemini-3.5-flash".into());
    m.insert("Gemini 3.1 Pro (Low)".into(), "gemini-3.1-pro".into());
    m.insert("Gemini 3.1 Pro (High)".into(), "gemini-3.1-pro".into());
    m.insert("Claude Sonnet 4.6 (Thinking)".into(), "claude-sonnet-4-5".into());
    m.insert("Claude Opus 4.6 (Thinking)".into(), "claude-opus-4-5".into());
    m.insert("GPT-OSS 120B (Medium)".into(), "gpt-4o".into());
    m.insert("Gemini 3 Flash (Command)".into(), "gemini-3-flash".into());
    m
}

/// Rewrite the model field in a request body based on the mapping.
/// Handles both OpenAI format (`model` field) and Anthropic format.
pub fn rewrite_model(body: &serde_json::Value, mappings: &HashMap<String, String>) -> serde_json::Value {
    let mut body = body.clone();
    if let Some(model) = body.get("model").and_then(|v| v.as_str()) {
        if let Some(mapped) = mappings.get(model) {
            body["model"] = serde_json::Value::String(mapped.clone());
        }
    }
    body
}
