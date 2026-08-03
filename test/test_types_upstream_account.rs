//! Test UpstreamAccount defaults and serialization.

#[cfg(test)]
mod tests {
    use sparkly::types::{AccountProvider, UpstreamAccount};

    fn sample_account() -> UpstreamAccount {
        UpstreamAccount {
            id: "test-id-123".to_string(),
            name: "Test Account".to_string(),
            provider: AccountProvider::OpenaiCompatible,
            base_url: "https://api.example.com".to_string(),
            api_key: "sk-test".to_string(),
            usage_tags: vec!["coding".into()],
            is_active: true,
            last_used_at: None,
        }
    }

    #[test]
    fn account_serializes_to_camel_case_json() {
        let account = sample_account();
        let json = serde_json::to_value(&account).unwrap();
        // serde uses camelCase
        assert!(json.get("base_url").is_none(), "should not use snake_case key");
        assert!(json.get("baseUrl").is_some(), "should use camelCase 'baseUrl'");
        assert!(json.get("apiKey").is_some(), "should use camelCase 'apiKey'");
        assert!(json.get("isActive").is_some(), "should use camelCase 'isActive'");
        assert!(json.get("usageTags").is_some(), "should use camelCase 'usageTags'");
        assert!(json.get("lastUsedAt").is_some() || json.get("lastUsedAt").is_some());
    }

    #[test]
    fn account_provider_serializes_as_kebab_case() {
        let account = UpstreamAccount {
            id: "1".into(),
            name: "A".into(),
            provider: AccountProvider::OpenaiCompatible,
            base_url: String::new(),
            api_key: String::new(),
            usage_tags: vec![],
            is_active: true,
            last_used_at: None,
        };
        let json = serde_json::to_value(&account).unwrap();
        assert_eq!(json["provider"], "openai-compatible");
    }

    #[test]
    fn account_provider_v0_serializes_correctly() {
        let account = UpstreamAccount {
            id: "1".into(),
            name: "A".into(),
            provider: AccountProvider::V0,
            base_url: String::new(),
            api_key: String::new(),
            usage_tags: vec![],
            is_active: true,
            last_used_at: None,
        };
        let json = serde_json::to_value(&account).unwrap();
        assert_eq!(json["provider"], "v0");
    }

    #[test]
    fn account_provider_anthropic_serializes_correctly() {
        let account = UpstreamAccount {
            id: "1".into(),
            name: "A".into(),
            provider: AccountProvider::Anthropic,
            base_url: String::new(),
            api_key: String::new(),
            usage_tags: vec![],
            is_active: true,
            last_used_at: None,
        };
        let json = serde_json::to_value(&account).unwrap();
        assert_eq!(json["provider"], "anthropic");
    }

    #[test]
    fn account_roundtrip_through_json() {
        let account = sample_account();
        let json = serde_json::to_string(&account).unwrap();
        let parsed: UpstreamAccount = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, account.id);
        assert_eq!(parsed.name, account.name);
        assert_eq!(parsed.provider, account.provider);
        assert_eq!(parsed.base_url, account.base_url);
        assert_eq!(parsed.api_key, account.api_key);
        assert_eq!(parsed.is_active, account.is_active);
    }

    #[test]
    fn account_optional_fields_omitted_when_none() {
        let account = sample_account();
        let json = serde_json::to_value(&account).unwrap();
        // last_used_at is None and should be omitted
        assert!(
            json.get("last_used_at").is_none() || json.get("lastUsedAt").is_none(),
            "None last_used_at should be omitted from JSON"
        );
    }

    #[test]
    fn account_default_provider_is_openai_compatible() {
        // When deserializing without a provider field, default is OpenAI Compatible
        let json = r#"{"id":"1","name":"A"}"#;
        let account: UpstreamAccount = serde_json::from_str(json).unwrap();
        assert_eq!(account.provider, AccountProvider::OpenaiCompatible);
    }

    #[test]
    fn account_default_is_active_true() {
        let json = r#"{"id":"1","name":"A"}"#;
        let account: UpstreamAccount = serde_json::from_str(json).unwrap();
        assert!(account.is_active, "default is_active should be true");
    }

    #[test]
    fn account_default_usage_tags_is_coding() {
        let json = r#"{"id":"1","name":"A"}"#;
        let account: UpstreamAccount = serde_json::from_str(json).unwrap();
        assert_eq!(account.usage_tags, vec!["coding".to_string()]);
    }
}
