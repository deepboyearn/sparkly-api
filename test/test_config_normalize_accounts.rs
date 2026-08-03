//! Test account normalization in normalize_config.

#[cfg(test)]
mod tests {
    use sparkly::config::normalize_config;
    use sparkly::types::{AccountProvider, BridgeConfig, UpstreamAccount};

    fn make_account(name: &str, provider: AccountProvider) -> UpstreamAccount {
        UpstreamAccount {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            provider,
            base_url: String::new(),
            api_key: String::new(),
            usage_tags: vec!["coding".into()],
            is_active: false,
            last_used_at: None,
        }
    }

    #[test]
    fn normalize_config_preserves_accounts() {
        let mut config = BridgeConfig::default();
        config.accounts = vec![make_account("My Account", AccountProvider::OpenaiCompatible)];
        let normalized = normalize_config(config);
        assert_eq!(normalized.accounts.len(), 1);
        assert_eq!(normalized.accounts[0].name, "My Account");
    }

    #[test]
    fn normalize_config_trims_account_names() {
        let mut config = BridgeConfig::default();
        config.accounts = vec![make_account("  Trimmed Name  ", AccountProvider::OpenaiCompatible)];
        let normalized = normalize_config(config);
        assert_eq!(normalized.accounts[0].name, "Trimmed Name");
    }

    #[test]
    fn normalize_config_generates_name_for_empty_name() {
        let mut config = BridgeConfig::default();
        let mut account = make_account("", AccountProvider::OpenaiCompatible);
        account.id = config.active_account_id.clone();
        config.accounts = vec![account];
        let normalized = normalize_config(config);
        assert_eq!(
            normalized.accounts[0].name,
            "Account 1",
            "empty name should be replaced with default"
        );
    }

    #[test]
    fn normalize_config_generates_name_for_v0_provider() {
        let mut config = BridgeConfig::default();
        let mut account = make_account("", AccountProvider::V0);
        account.id = config.active_account_id.clone();
        config.accounts = vec![account];
        let normalized = normalize_config(config);
        assert_eq!(normalized.accounts[0].name, "v0");
    }

    #[test]
    fn normalize_config_generates_name_for_anthropic_provider() {
        let mut config = BridgeConfig::default();
        let mut account = make_account("", AccountProvider::Anthropic);
        account.id = config.active_account_id.clone();
        config.accounts = vec![account];
        let normalized = normalize_config(config);
        assert_eq!(normalized.accounts[0].name, "anthropic");
    }

    #[test]
    fn normalize_config_fills_default_base_url() {
        let mut config = BridgeConfig::default();
        let mut account = make_account("Test", AccountProvider::OpenaiCompatible);
        account.base_url = String::new();
        account.id = config.active_account_id.clone();
        config.accounts = vec![account];
        let normalized = normalize_config(config);
        assert_eq!(
            normalized.accounts[0].base_url,
            sparkly::types::DEFAULT_UPSTREAM_BASE_URL,
            "empty base_url should be filled with provider default"
        );
    }

    #[test]
    fn normalize_config_trims_trailing_slash_from_base_url() {
        let mut config = BridgeConfig::default();
        let mut account = make_account("Test", AccountProvider::OpenaiCompatible);
        account.base_url = "https://example.com/v1/".to_string();
        account.id = config.active_account_id.clone();
        config.accounts = vec![account];
        let normalized = normalize_config(config);
        assert_eq!(
            normalized.accounts[0].base_url,
            "https://example.com/v1",
            "trailing slash should be trimmed"
        );
    }

    #[test]
    fn normalize_config_ensures_one_active_account() {
        let mut config = BridgeConfig::default();
        config.accounts = vec![
            make_account("A", AccountProvider::OpenaiCompatible),
            make_account("B", AccountProvider::OpenaiCompatible),
        ];
        // Set no account as active
        config.active_account_id = String::new();
        let normalized = normalize_config(config);
        let active_count = normalized.accounts.iter().filter(|a| a.is_active).count();
        assert_eq!(active_count, 1, "exactly one account should be active");
    }

    #[test]
    fn normalize_config_empty_accounts_returns_empty() {
        let mut config = BridgeConfig::default();
        config.accounts = Vec::new();
        let normalized = normalize_config(config);
        assert!(normalized.accounts.is_empty());
    }

    #[test]
    fn normalize_config_assigns_id_to_empty_id_account() {
        let mut config = BridgeConfig::default();
        let mut account = make_account("Test", AccountProvider::OpenaiCompatible);
        account.id = String::new();
        account.id = config.active_account_id.clone();
        config.accounts = vec![account];
        let normalized = normalize_config(config);
        assert!(
            !normalized.accounts[0].id.is_empty(),
            "account with empty ID should get a generated UUID"
        );
    }
}
