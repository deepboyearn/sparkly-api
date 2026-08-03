//! Test BridgeConfig default values.

#[cfg(test)]
mod tests {
    use sparkly::types::{
        BridgeConfig, AccountProvider, DEFAULT_LOCAL_PORT, DEFAULT_MODELS, DEFAULT_SELECTED_MODEL,
        DEFAULT_UPSTREAM_BASE_URL, MAX_LOCAL_PORT, MIN_LOCAL_PORT,
    };

    #[test]
    fn default_config_has_correct_port() {
        let config = BridgeConfig::default();
        assert_eq!(config.local_port, DEFAULT_LOCAL_PORT);
    }

    #[test]
    fn default_config_has_correct_selected_model() {
        let config = BridgeConfig::default();
        assert_eq!(config.selected_model, DEFAULT_SELECTED_MODEL);
    }

    #[test]
    fn default_config_has_correct_base_url() {
        let config = BridgeConfig::default();
        assert_eq!(config.upstream_base_url, DEFAULT_UPSTREAM_BASE_URL);
    }

    #[test]
    fn default_config_has_empty_api_key() {
        let config = BridgeConfig::default();
        assert!(config.api_key.is_empty(), "default api_key should be empty");
    }

    #[test]
    fn default_config_has_cors_enabled() {
        let config = BridgeConfig::default();
        assert!(config.enable_cors, "CORS should be enabled by default");
    }

    #[test]
    fn default_config_has_empty_system_prompt() {
        let config = BridgeConfig::default();
        assert!(config.system_prompt.is_empty(), "default system_prompt should be empty");
    }

    #[test]
    fn default_config_has_all_default_models() {
        let config = BridgeConfig::default();
        for model in DEFAULT_MODELS {
            assert!(
                config.models.contains(&model.to_string()),
                "default config should contain model '{}'",
                model
            );
        }
    }

    #[test]
    fn default_config_has_one_account() {
        let config = BridgeConfig::default();
        assert_eq!(config.accounts.len(), 1, "should have exactly one default account");
    }

    #[test]
    fn default_config_account_is_openai_compatible() {
        let config = BridgeConfig::default();
        assert_eq!(config.accounts[0].provider, AccountProvider::OpenaiCompatible);
    }

    #[test]
    fn default_config_account_is_active() {
        let config = BridgeConfig::default();
        assert!(config.accounts[0].is_active, "default account should be active");
    }

    #[test]
    fn default_config_account_has_correct_name() {
        let config = BridgeConfig::default();
        assert_eq!(config.accounts[0].name, "Primary Account");
    }

    #[test]
    fn default_config_account_has_empty_api_key() {
        let config = BridgeConfig::default();
        assert!(config.accounts[0].api_key.is_empty());
    }

    #[test]
    fn default_config_active_account_id_matches_account() {
        let config = BridgeConfig::default();
        assert_eq!(config.active_account_id, config.accounts[0].id);
    }

    #[test]
    fn default_config_port_in_valid_range() {
        let config = BridgeConfig::default();
        assert!(config.local_port >= MIN_LOCAL_PORT);
        assert!(config.local_port <= MAX_LOCAL_PORT);
    }

    #[test]
    fn default_config_serializes_to_json() {
        let config = BridgeConfig::default();
        let json = serde_json::to_string(&config);
        assert!(json.is_ok(), "default config should serialize");
    }

    #[test]
    fn default_config_deserializes_from_json() {
        let config = BridgeConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: Result<BridgeConfig, _> = serde_json::from_str(&json);
        assert!(parsed.is_ok(), "default config should deserialize");
        let parsed = parsed.unwrap();
        assert_eq!(parsed.local_port, config.local_port);
        assert_eq!(parsed.selected_model, config.selected_model);
    }
}
