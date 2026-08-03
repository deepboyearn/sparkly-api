//! Test rewrite_model() when no mapping exists for the model.

#[cfg(test)]
mod tests {
    use sparkly::model_mapper::{default_mappings, rewrite_model};

    #[test]
    fn no_mapping_preserves_original_model() {
        let body = serde_json::json!({"model": "nonexistent-model"});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "nonexistent-model");
    }

    #[test]
    fn empty_mappings_pass_through() {
        let body = serde_json::json!({"model": "gpt-4"});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "gpt-4");
    }

    #[test]
    fn no_mapping_preserves_body_intact() {
        let body = serde_json::json!({
            "model": "unknown-model",
            "stream": true,
            "messages": [{"role": "user", "content": "hi"}]
        });
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "unknown-model");
        assert_eq!(result["stream"], true);
        assert_eq!(result["messages"][0]["role"], "user");
    }

    #[test]
    fn partial_match_not_rewritten() {
        let body = serde_json::json!({"model": "Gemini 3.6 Flash"});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        // "Gemini 3.6 Flash" is not a key — only the parenthesized variants are
        assert_eq!(result["model"], "Gemini 3.6 Flash");
    }

    #[test]
    fn case_sensitive_matching() {
        let body = serde_json::json!({"model": "gemini 3.6 flash (high)"});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        // Lowercase variant is NOT a key in the mapping — should be preserved
        assert_eq!(result["model"], "gemini 3.6 flash (high)");
    }

    #[test]
    fn extra_whitespace_in_model_not_rewritten() {
        let body = serde_json::json!({"model": "  Gemini 3.6 Flash (High)  "});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        // The leading/trailing spaces make it not match
        assert_eq!(result["model"], "  Gemini 3.6 Flash (High)  ");
    }
}
