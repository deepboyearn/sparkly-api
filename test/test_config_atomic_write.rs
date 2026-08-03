//! Test atomic file write (temp + rename pattern).

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    fn tmp_data_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sparkly_test_atomic_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn persist_config_does_not_leave_temp_files() {
        let dir = tmp_data_dir();
        let config = sparkly::types::BridgeConfig::default();
        sparkly::config::persist_config(&config, &dir).unwrap();

        // After persist, no .tmp files should remain in the directory
        let entries: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.starts_with('.') && n.ends_with(".tmp"))
                    .unwrap_or(false)
            })
            .collect();

        assert!(
            entries.is_empty(),
            "no temp files should remain after atomic write, found: {:?}",
            entries.iter().map(|e| e.file_name()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn persist_config_target_file_exists_after_write() {
        let dir = tmp_data_dir();
        let config = sparkly::types::BridgeConfig::default();
        sparkly::config::persist_config(&config, &dir).unwrap();
        let path = dir.join("bridge-config.json");
        assert!(path.exists(), "target config file should exist");
    }

    #[test]
    fn persist_config_file_content_is_valid_json() {
        let dir = tmp_data_dir();
        let config = sparkly::types::BridgeConfig::default();
        sparkly::config::persist_config(&config, &dir).unwrap();
        let path = dir.join("bridge-config.json");
        let content = fs::read_to_string(&path).unwrap();
        let parsed: Result<serde_json::Value, _> = serde_json::from_str(&content);
        assert!(parsed.is_ok(), "written file should be valid JSON");
    }

    #[test]
    fn persist_config_overwrites_existing_file() {
        let dir = tmp_data_dir();
        let mut config1 = sparkly::types::BridgeConfig::default();
        config1.local_port = 40000;
        sparkly::config::persist_config(&config1, &dir).unwrap();

        let mut config2 = sparkly::types::BridgeConfig::default();
        config2.local_port = 50000;
        sparkly::config::persist_config(&config2, &dir).unwrap();

        let loaded = sparkly::config::load_config(&dir);
        assert_eq!(loaded.local_port, 50000, "second write should overwrite first");
    }

    #[test]
    fn atomic_write_preserves_file_content() {
        let dir = tmp_data_dir();
        let config = sparkly::types::BridgeConfig::default();
        let json = serde_json::to_string_pretty(&config).unwrap();
        sparkly::config::persist_config(&config, &dir).unwrap();
        let path = dir.join("bridge-config.json");
        let disk_content = fs::read_to_string(&path).unwrap();
        assert_eq!(disk_content.len(), json.len(), "file size should match serialized content");
    }

    #[test]
    fn persist_client_keys_creates_file() {
        let dir = tmp_data_dir();
        let keys: Vec<sparkly::types::ClientApiKey> = Vec::new();
        sparkly::config::persist_client_keys(&keys, &dir).unwrap();
        let path = dir.join("client-keys.json");
        assert!(path.exists(), "client keys file should be created");
    }

    #[test]
    fn persist_client_keys_roundtrip() {
        let dir = tmp_data_dir();
        let keys: Vec<sparkly::types::ClientApiKey> = Vec::new();
        sparkly::config::persist_client_keys(&keys, &dir).unwrap();
        let loaded = sparkly::config::load_client_keys(&dir);
        assert!(loaded.is_empty(), "empty keys should roundtrip to empty");
    }

    #[test]
    fn persist_client_keys_no_temp_files() {
        let dir = tmp_data_dir();
        let keys: Vec<sparkly::types::ClientApiKey> = Vec::new();
        sparkly::config::persist_client_keys(&keys, &dir).unwrap();

        let entries: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.starts_with('.') && n.ends_with(".tmp"))
                    .unwrap_or(false)
            })
            .collect();

        assert!(entries.is_empty(), "no temp files should remain after persist_client_keys");
    }
}
