//! Test ClientApiKey generation and structure.

#[cfg(test)]
mod tests {
    use sparkly::types::ClientApiKey;

    fn sample_key() -> ClientApiKey {
        ClientApiKey {
            id: "key-001".to_string(),
            name: "My API Key".to_string(),
            key: "sk-1234567890abcdef1234567890abcdef".to_string(),
            masked_key: "sk-12345••••••••••••••••abcdef".to_string(),
            created_at: "2025-01-01T00:00:00Z".to_string(),
            last_used_at: None,
            is_active: true,
        }
    }

    #[test]
    fn key_serializes_to_camel_case() {
        let key = sample_key();
        let json = serde_json::to_value(&key).unwrap();
        assert!(json.get("maskedKey").is_some(), "should use camelCase 'maskedKey'");
        assert!(json.get("createdAt").is_some(), "should use camelCase 'createdAt'");
        assert!(json.get("lastUsedAt").is_some() || json.get("lastUsedAt").is_some());
        assert!(json.get("isActive").is_some(), "should use camelCase 'isActive'");
    }

    #[test]
    fn key_roundtrip_through_json() {
        let key = sample_key();
        let json = serde_json::to_string(&key).unwrap();
        let parsed: ClientApiKey = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, key.id);
        assert_eq!(parsed.name, key.name);
        assert_eq!(parsed.key, key.key);
        assert_eq!(parsed.masked_key, key.masked_key);
        assert_eq!(parsed.created_at, key.created_at);
    }

    #[test]
    fn key_optional_last_used_at_omitted_when_none() {
        let key = sample_key();
        let json = serde_json::to_value(&key).unwrap();
        // None + skip_serializing_if means field is absent
        assert!(
            json.get("last_used_at").is_none() && json.get("lastUsedAt").is_none(),
            "None lastUsedAt should be omitted"
        );
    }

    #[test]
    fn key_optional_last_used_at_present_when_some() {
        let mut key = sample_key();
        key.last_used_at = Some("2025-06-01T12:00:00Z".to_string());
        let json = serde_json::to_value(&key).unwrap();
        assert!(
            json.get("lastUsedAt").is_some(),
            "Some(lastUsedAt) should be present in JSON"
        );
        assert_eq!(json["lastUsedAt"], "2025-06-01T12:00:00Z");
    }

    #[test]
    fn key_default_is_active_true() {
        // When deserializing without isActive field, default is true
        let json = r#"{"id":"k1","name":"Key","key":"sk-xxx","maskedKey":"sk-••••","createdAt":"2025-01-01"}"#;
        let parsed: ClientApiKey = serde_json::from_str(json).unwrap();
        assert!(parsed.is_active, "default is_active should be true");
    }

    #[test]
    fn key_with_all_fields_deserializes() {
        let json = r#"{
            "id": "key-1",
            "name": "Test",
            "key": "secret-key-value",
            "maskedKey": "secret-•••••••••••••••••",
            "createdAt": "2025-03-15T10:30:00Z",
            "lastUsedAt": "2025-04-01T08:00:00Z",
            "isActive": true
        }"#;
        let parsed: ClientApiKey = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.id, "key-1");
        assert_eq!(parsed.name, "Test");
        assert_eq!(parsed.key, "secret-key-value");
        assert!(parsed.last_used_at.is_some());
    }

    #[test]
    fn masking_preserves_first_9_and_last_6_chars() {
        // Simulate the mask_client_key logic
        let key = "sk-1234567890abcdef1234567890abcdef";
        let chars: Vec<char> = key.chars().collect();
        let head: String = chars.iter().take(9).collect();
        let tail_start = chars.len().saturating_sub(6);
        let tail: String = chars[tail_start..].iter().collect();
        assert_eq!(head, "sk-123456", "first 9 chars should be preserved");
        assert_eq!(tail, "90abcdef", "last 6 chars should be preserved");
    }
}
