//! Test rewrite_model() with empty or invalid body.

#[cfg(test)]
mod tests {
    use sparkly::model_mapper::{default_mappings, rewrite_model};

    #[test]
    fn empty_object_body_unchanged() {
        let body = serde_json::json!({});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result, serde_json::json!({}));
    }

    #[test]
    fn body_without_model_field_unchanged() {
        let body = serde_json::json!({
            "temperature": 0.5,
            "messages": []
        });
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["temperature"], 0.5);
        assert!(!result.as_object().unwrap().contains_key("model"));
    }

    #[test]
    fn model_field_with_null_value_unchanged() {
        let body = serde_json::json!({"model": null});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        // null is not a string, so as_str() returns None — no rewrite
        assert_eq!(result["model"], serde_json::Value::Null);
    }

    #[test]
    fn model_field_with_numeric_value_unchanged() {
        let body = serde_json::json!({"model": 42});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], 42);
    }

    #[test]
    fn model_field_with_array_value_unchanged() {
        let body = serde_json::json!({"model": ["list", "of", "models"]});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert!(result["model"].is_array());
    }

    #[test]
    fn model_field_with_empty_string_unchanged() {
        let body = serde_json::json!({"model": ""});
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        // Empty string is not a mapping key, so it passes through
        assert_eq!(result["model"], "");
    }

    #[test]
    fn deeply_nested_body_preserves_all_fields() {
        let body = serde_json::json!({
            "model": "unknown",
            "metadata": {"user_id": "123", "session": "abc"},
            "config": {"nested": {"deep": true}}
        });
        let mappings = default_mappings();
        let result = rewrite_model(&body, &mappings);
        assert_eq!(result["model"], "unknown");
        assert_eq!(result["metadata"]["user_id"], "123");
        assert_eq!(result["config"]["nested"]["deep"], true);
    }
}
