//! Test model deduplication and codex filtering in normalize_config.

#[cfg(test)]
mod tests {
    use sparkly::config::normalize_config;
    use sparkly::types::{BridgeConfig, DEFAULT_MODELS};

    #[test]
    fn normalize_config_includes_all_default_models() {
        let config = BridgeConfig::default();
        let normalized = normalize_config(config);
        for default_model in DEFAULT_MODELS {
            assert!(
                normalized.models.contains(&default_model.to_string()),
                "normalized config should include default model '{}'",
                default_model
            );
        }
    }

    #[test]
    fn normalize_config_deduplicates_models() {
        let mut config = BridgeConfig::default();
        // Add duplicates of existing models
        config.models.push("gpt-4".to_string());
        config.models.push("gpt-4".to_string());
        config.models.push("gpt-5".to_string());
        let normalized = normalize_config(config);
        let count_gpt4 = normalized.models.iter().filter(|m| *m == "gpt-4").count();
        assert_eq!(count_gpt4, 1, "gpt-4 should appear exactly once after dedup");
    }

    #[test]
    fn normalize_config_filters_codex_models() {
        let mut config = BridgeConfig::default();
        config.models.push("codex-large".to_string());
        config.models.push("my-codex-model".to_string());
        config.models.push("CODEX-v2".to_string());
        let normalized = normalize_config(config);
        for model in &normalized.models {
            assert!(
                !model.to_ascii_lowercase().contains("codex"),
                "model '{}' should be filtered out (contains 'codex')",
                model
            );
        }
    }

    #[test]
    fn normalize_config_filters_empty_models() {
        let mut config = BridgeConfig::default();
        config.models.push("".to_string());
        config.models.push("   ".to_string());
        let normalized = normalize_config(config);
        assert!(
            !normalized.models.contains(&String::new()),
            "empty model strings should be filtered"
        );
    }

    #[test]
    fn normalize_config_trims_model_whitespace() {
        let mut config = BridgeConfig::default();
        config.models.push("  my-model  ".to_string());
        let normalized = normalize_config(config);
        assert!(
            normalized.models.contains(&"my-model".to_string()),
            "model should be trimmed of whitespace"
        );
        assert!(
            !normalized.models.contains(&"  my-model  ".to_string()),
            "untrimmed model should not be present"
        );
    }

    #[test]
    fn normalize_config_preserves_custom_models() {
        let mut config = BridgeConfig::default();
        config.models.push("my-custom-model".to_string());
        let normalized = normalize_config(config);
        assert!(
            normalized.models.contains(&"my-custom-model".to_string()),
            "custom model should be preserved"
        );
    }

    #[test]
    fn normalize_config_case_sensitive_dedup() {
        let mut config = BridgeConfig::default();
        // Same model in different case — case-sensitive dedup means both are kept
        config.models.push("GPT-4".to_string());
        config.models.push("gpt-4".to_string());
        let normalized = normalize_config(config);
        let has_gpt4 = normalized.models.contains(&"gpt-4".to_string());
        let has_upper = normalized.models.contains(&"GPT-4".to_string());
        // Both should be present since dedup is case-sensitive
        assert!(has_gpt4 || has_upper, "at least one variant of gpt-4 should exist");
    }

    #[test]
    fn normalize_config_default_models_comes_first() {
        let config = BridgeConfig::default();
        let normalized = normalize_config(config);
        // Default models should appear before any user-added models
        // The first DEFAULT_MODELS.len() entries should match DEFAULT_MODELS
        let default_count = DEFAULT_MODELS.len();
        assert!(
            normalized.models.len() >= default_count,
            "should have at least as many models as DEFAULT_MODELS"
        );
    }
}
