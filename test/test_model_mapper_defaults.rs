//! Test default_mappings() returns all 12 models.

#[cfg(test)]
mod tests {
    use sparkly::model_mapper::default_mappings;

    #[test]
    fn default_mappings_returns_exactly_12_entries() {
        let mappings = default_mappings();
        assert_eq!(mappings.len(), 12, "default_mappings should contain exactly 12 entries");
    }

    #[test]
    fn gemini_36_flash_high_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Gemini 3.6 Flash (High)").map(|s| s.as_str()),
            Some("gemini-3.6-flash")
        );
    }

    #[test]
    fn gemini_36_flash_medium_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Gemini 3.6 Flash (Medium)").map(|s| s.as_str()),
            Some("gemini-3.6-flash")
        );
    }

    #[test]
    fn gemini_36_flash_low_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Gemini 3.6 Flash (Low)").map(|s| s.as_str()),
            Some("gemini-3.6-flash")
        );
    }

    #[test]
    fn gemini_35_flash_default_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Gemini 3.5 Flash (Medium) / Default").map(|s| s.as_str()),
            Some("gemini-3.5-flash")
        );
    }

    #[test]
    fn gemini_35_flash_high_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Gemini 3.5 Flash (High)").map(|s| s.as_str()),
            Some("gemini-3.5-flash")
        );
    }

    #[test]
    fn gemini_35_flash_low_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Gemini 3.5 Flash (Low)").map(|s| s.as_str()),
            Some("gemini-3.5-flash")
        );
    }

    #[test]
    fn gemini_31_pro_low_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Gemini 3.1 Pro (Low)").map(|s| s.as_str()),
            Some("gemini-3.1-pro")
        );
    }

    #[test]
    fn gemini_31_pro_high_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Gemini 3.1 Pro (High)").map(|s| s.as_str()),
            Some("gemini-3.1-pro")
        );
    }

    #[test]
    fn claude_sonnet_thinking_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Claude Sonnet 4.6 (Thinking)").map(|s| s.as_str()),
            Some("claude-sonnet-4-5")
        );
    }

    #[test]
    fn claude_opus_thinking_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Claude Opus 4.6 (Thinking)").map(|s| s.as_str()),
            Some("claude-opus-4-5")
        );
    }

    #[test]
    fn gpt_oss_120b_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("GPT-OSS 120B (Medium)").map(|s| s.as_str()),
            Some("gpt-4o")
        );
    }

    #[test]
    fn gemini_3_flash_command_maps_to_correct_id() {
        let mappings = default_mappings();
        assert_eq!(
            mappings.get("Gemini 3 Flash (Command)").map(|s| s.as_str()),
            Some("gemini-3-flash")
        );
    }

    #[test]
    fn all_values_are_non_empty_strings() {
        let mappings = default_mappings();
        for (key, value) in &mappings {
            assert!(!key.is_empty(), "mapping key should not be empty");
            assert!(!value.is_empty(), "mapping value for '{}' should not be empty", key);
        }
    }

    #[test]
    fn no_key_looks_like_a_value() {
        let mappings = default_mappings();
        let keys: Vec<&str> = mappings.keys().map(|k| k.as_str()).collect();
        for value in mappings.values() {
            assert!(
                !keys.contains(&value.as_str()),
                "no key should equal a value (got '{}')",
                value
            );
        }
    }
}
