//! Test rewrite_model() correctly rewrites the model field.

#[cfg(test)]
mod tests {
    use sparkly::model_mapper::{default_mappings, rewrite_model};

    #[test]
    fn rewrite_model_replaces_known_model() {
        let body = serde_json::json!({
            "model": "Gemini 3.6 Flash (High)",
            "messages": [{"role": "user", "content": "hi"}]
        });
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "gemini-3.6-flash");
    }

    #[test]
    fn rewrite_model_preserves_other_fields() {
        let body = serde_json::json!({
            "model": "Gemini 3.6 Flash (High)",
            "temperature": 0.7,
            "max_tokens": 1024
        });
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "gemini-3.6-flash");
        assert_eq!(result["temperature"], 0.7);
        assert_eq!(result["max_tokens"], 1024);
    }

    #[test]
    fn rewrite_model_preserves_nested_structures() {
        let body = serde_json::json!({
            "model": "Claude Sonnet 4.6 (Thinking)",
            "messages": [
                {"role": "system", "content": "You are helpful."},
                {"role": "user", "content": "Hello"}
            ],
            "tools": [{"type": "function", "function": {"name": "search"}}]
        });
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "claude-sonnet-4-5");
        assert!(result["messages"].is_array());
        assert!(result["messages"][0]["role"] == "system");
        assert!(result["tools"].is_array());
    }

    #[test]
    fn rewrite_model_with_custom_mapping() {
        let body = serde_json::json!({"model": "my-custom-model"});
        let mut mappings = default_mappings();
        mappings.insert("my-custom-model".into(), "upstream/model-v2".into());
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "upstream/model-v2");
    }

    #[test]
    fn rewrite_model_with_gpt_oss() {
        let body = serde_json::json!({"model": "GPT-OSS 120B (Medium)"});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "gpt-4o");
    }

    #[test]
    fn rewrite_model_preserves_model_type_as_string() {
        let body = serde_json::json!({"model": "Gemini 3.6 Flash (Low)"});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert!(result["model"].is_string(), "model should remain a string");
    }

    #[test]
    fn rewrite_model_with_empty_mappings_does_not_modify() {
        let body = serde_json::json!({"model": "some-model"});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "some-model", "unknown model should pass through unchanged");
    }
}
