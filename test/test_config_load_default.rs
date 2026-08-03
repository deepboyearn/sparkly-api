//! Test loading default config when no file exists.

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    fn tmp_data_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sparkly_test_load_default_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn load_config_returns_defaults_when_no_file() {
        let dir = tmp_data_dir();
        let config = sparkly::config::load_config(&dir);
        // Default config should have the default port
        assert_eq!(config.local_port, sparkly::types::DEFAULT_LOCAL_PORT);
    }

    #[test]
    fn load_config_creates_config_file_on_first_run() {
        let dir = tmp_data_dir();
        let _ = sparkly::config::load_config(&dir);
        let config_path = dir.join("bridge-config.json");
        assert!(config_path.exists(), "load_config should create the config file on first run");
    }

    #[test]
    fn load_config_returns_default_model() {
        let dir = tmp_data_dir();
        let config = sparkly::config::load_config(&dir);
        assert_eq!(config.selected_model, sparkly::types::DEFAULT_SELECTED_MODEL);
    }

    #[test]
    fn load_config_has_default_accounts() {
        let dir = tmp_data_dir();
        let config = sparkly::config::load_config(&dir);
        assert!(
            !config.accounts.is_empty(),
            "default config should have at least one account"
        );
    }

    #[test]
    fn load_config_first_account_is_active() {
        let dir = tmp_data_dir();
        let config = sparkly::config::load_config(&dir);
        let active_accounts: Vec<_> = config.accounts.iter().filter(|a| a.is_active).collect();
        assert_eq!(
            active_accounts.len(),
            1,
            "exactly one account should be active"
        );
    }

    #[test]
    fn load_config_has_default_models_catalog() {
        let dir = tmp_data_dir();
        let config = sparkly::config::load_config(&dir);
        // The default models list should have all DEFAULT_MODELS entries
        assert!(
            config.models.len() >= sparkly::types::DEFAULT_MODELS.len(),
            "config models should include all DEFAULT_MODELS"
        );
    }

    #[test]
    fn load_config_cors_enabled_by_default() {
        let dir = tmp_data_dir();
        let config = sparkly::config::load_config(&dir);
        assert!(config.enable_cors, "CORS should be enabled by default");
    }

    #[test]
    fn load_config_returns_serializable_config() {
        let dir = tmp_data_dir();
        let config = sparkly::config::load_config(&dir);
        let json = serde_json::to_string(&config);
        assert!(json.is_ok(), "default config should be serializable");
    }

    #[test]
    fn load_config_returns_deserializable_config() {
        let dir = tmp_data_dir();
        let config = sparkly::config::load_config(&dir);
        let json = serde_json::to_string(&config).unwrap();
        let parsed: Result<sparkly::types::BridgeConfig, _> = serde_json::from_str(&json);
        assert!(parsed.is_ok(), "default config should round-trip through JSON");
    }
}
