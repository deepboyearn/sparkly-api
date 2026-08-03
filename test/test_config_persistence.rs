//! Test config save/load roundtrip.

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    fn tmp_data_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sparkly_test_persist_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_and_load_roundtrip_preserves_config() {
        let dir = tmp_data_dir();
        let mut config = sparkly::types::BridgeConfig::default();
        config.local_port = 50000;
        config.selected_model = "claude-sonnet-4-6".to_string();
        config.enable_cors = false;

        sparkly::config::persist_config(&config, &dir).unwrap();
        let loaded = sparkly::config::load_config(&dir);

        assert_eq!(loaded.local_port, 50000);
        assert_eq!(loaded.selected_model, "claude-sonnet-4-6");
        assert!(!loaded.enable_cors);
    }

    #[test]
    fn save_and_load_preserves_models_list() {
        let dir = tmp_data_dir();
        let mut config = sparkly::types::BridgeConfig::default();
        config.models.push("custom-model".to_string());

        sparkly::config::persist_config(&config, &dir).unwrap();
        let loaded = sparkly::config::load_config(&dir);

        assert!(
            loaded.models.contains(&"custom-model".to_string()),
            "custom model should survive roundtrip"
        );
    }

    #[test]
    fn save_and_load_preserves_accounts() {
        let dir = tmp_data_dir();
        let mut config = sparkly::types::BridgeConfig::default();
        // Modify the first account
        if let Some(account) = config.accounts.first_mut() {
            account.name = "Roundtrip Account".to_string();
            account.api_key = "test-key-123".to_string();
        }

        sparkly::config::persist_config(&config, &dir).unwrap();
        let loaded = sparkly::config::load_config(&dir);

        assert!(
            loaded.accounts.iter().any(|a| a.name == "Roundtrip Account"),
            "account name should survive roundtrip"
        );
    }

    #[test]
    fn save_and_load_preserves_system_prompt() {
        let dir = tmp_data_dir();
        let mut config = sparkly::types::BridgeConfig::default();
        config.system_prompt = "You are a helpful assistant.".to_string();

        sparkly::config::persist_config(&config, &dir).unwrap();
        let loaded = sparkly::config::load_config(&dir);

        assert_eq!(loaded.system_prompt, "You are a helpful assistant.");
    }

    #[test]
    fn persist_config_creates_config_file() {
        let dir = tmp_data_dir();
        let config = sparkly::types::BridgeConfig::default();
        sparkly::config::persist_config(&config, &dir).unwrap();
        let path = dir.join("bridge-config.json");
        assert!(path.exists(), "config file should exist after persist");
    }

    #[test]
    fn persist_config_creates_valid_json() {
        let dir = tmp_data_dir();
        let config = sparkly::types::BridgeConfig::default();
        sparkly::config::persist_config(&config, &dir).unwrap();
        let path = dir.join("bridge-config.json");
        let content = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed.is_object(), "config file should contain a JSON object");
    }

    #[test]
    fn save_config_normalizes_then_persists() {
        let dir = tmp_data_dir();
        let mut config = sparkly::types::BridgeConfig::default();
        config.models.push("  padded-model  ".to_string());
        config.models.push("codex-leaked".to_string());

        sparkly::config::save_config(&mut config, &dir).unwrap();
        // After save_config, the in-memory config is also normalized
        assert!(
            !config.models.contains(&"  padded-model  ".to_string()),
            "save_config should normalize in-memory too"
        );
        assert!(
            !config.models.iter().any(|m| m.contains("codex")),
            "codex models should be filtered by save_config"
        );
    }

    #[test]
    fn load_config_handles_corrupt_json() {
        let dir = tmp_data_dir();
        let path = dir.join("bridge-config.json");
        fs::write(&path, "not valid json {{{").unwrap();
        // load_config should return defaults on corrupt JSON
        let config = sparkly::config::load_config(&dir);
        assert_eq!(config.local_port, sparkly::types::DEFAULT_LOCAL_PORT);
    }
}
