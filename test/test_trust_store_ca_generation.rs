//! Test CA cert generation, file creation, and permissions.

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    /// Helper: create a fresh temp dir for each test.
    fn tmp_data_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sparkly_test_ca_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ca_paths_returns_key_and_crt_in_mitm_certs_dir() {
        let data_dir = tmp_data_dir();
        let (key_path, cert_path) = sparkly::trust_store::ca_paths(&data_dir);
        assert!(
            key_path.to_string_lossy().ends_with("rootCA.key"),
            "key path should end with rootCA.key"
        );
        assert!(
            cert_path.to_string_lossy().ends_with("rootCA.crt"),
            "cert path should end with rootCA.crt"
        );
        // Both should be under mitm-certs/
        assert!(
            key_path.to_string_lossy().contains("mitm-certs"),
            "key should be under mitm-certs/"
        );
        assert!(
            cert_path.to_string_lossy().contains("mitm-certs"),
            "cert should be under mitm-certs/"
        );
    }

    #[test]
    fn ca_paths_creates_mitm_certs_directory() {
        let data_dir = tmp_data_dir();
        let (key_path, cert_path) = sparkly::trust_store::ca_paths(&data_dir);
        // ca_paths calls create_dir_all internally
        assert!(
            key_path.parent().unwrap().exists(),
            "mitm-certs directory should be created by ca_paths"
        );
        assert!(
            cert_path.parent().unwrap().exists(),
            "mitm-certs directory should exist"
        );
    }

    #[test]
    fn generate_ca_produces_valid_key_and_cert_files() {
        let data_dir = tmp_data_dir();
        let result = sparkly::trust_store::generate_ca(&data_dir);
        assert!(result.is_ok(), "generate_ca should succeed: {:?}", result.err());
        let (key_pem, cert_pem) = result.unwrap();
        assert!(!key_pem.is_empty(), "key PEM should not be empty");
        assert!(!cert_pem.is_empty(), "cert PEM should not be empty");
        assert!(
            String::from_utf8_lossy(&key_pem).contains("PRIVATE KEY"),
            "key should contain PEM PRIVATE KEY marker"
        );
        assert!(
            String::from_utf8_lossy(&cert_pem).contains("CERTIFICATE"),
            "cert should contain PEM CERTIFICATE marker"
        );
    }

    #[test]
    fn generate_ca_writes_files_to_disk() {
        let data_dir = tmp_data_dir();
        sparkly::trust_store::generate_ca(&data_dir).unwrap();
        let (key_path, cert_path) = sparkly::trust_store::ca_paths(&data_dir);
        assert!(key_path.exists(), "key file should exist on disk");
        assert!(cert_path.exists(), "cert file should exist on disk");
    }

    #[test]
    fn generate_ca_overwrites_existing() {
        let data_dir = tmp_data_dir();
        let (_, cert1) = sparkly::trust_store::generate_ca(&data_dir).unwrap();
        let (_, cert2) = sparkly::trust_store::generate_ca(&data_dir).unwrap();
        // Certs are regenerated; they should be valid PEM (but not necessarily identical
        // since rcgen generates new keys each time).
        assert!(!cert1.is_empty());
        assert!(!cert2.is_empty());
    }

    #[test]
    fn get_or_generate_ca_creates_when_missing() {
        let data_dir = tmp_data_dir();
        assert!(!sparkly::trust_store::cert_exists(&data_dir));
        let result = sparkly::trust_store::get_or_generate_ca(&data_dir);
        assert!(result.is_ok(), "get_or_generate_ca should succeed: {:?}", result.err());
        assert!(sparkly::trust_store::cert_exists(&data_dir));
    }

    #[test]
    fn get_or_generate_ca_returns_existing_when_present() {
        let data_dir = tmp_data_dir();
        let (key1, cert1) = sparkly::trust_store::generate_ca(&data_dir).unwrap();
        let (key2, cert2) = sparkly::trust_store::get_or_generate_ca(&data_dir).unwrap();
        // get_or_generate should return the same bytes when files already exist
        assert_eq!(key1, key2, "should return the same key bytes");
        assert_eq!(cert1, cert2, "should return the same cert bytes");
    }

    #[cfg(unix)]
    #[test]
    fn generate_ca_sets_key_permissions_to_0600() {
        use std::os::unix::fs::PermissionsExt;
        let data_dir = tmp_data_dir();
        sparkly::trust_store::generate_ca(&data_dir).unwrap();
        let (key_path, _) = sparkly::trust_store::ca_paths(&data_dir);
        let metadata = fs::metadata(&key_path).unwrap();
        let mode = metadata.permissions().mode();
        assert_eq!(
            mode & 0o777,
            0o600,
            "CA key should have 0600 permissions, got {:o}",
            mode & 0o777
        );
    }

    #[test]
    fn generate_ca_cert_is_valid_pem() {
        let data_dir = tmp_data_dir();
        let (_, cert_pem) = sparkly::trust_store::generate_ca(&data_dir).unwrap();
        let cert_str = String::from_utf8(&cert_pem).unwrap();
        assert!(
            cert_str.starts_with("-----BEGIN CERTIFICATE-----"),
            "cert should start with PEM header"
        );
        assert!(
            cert_str.trim_end().ends_with("-----END CERTIFICATE-----"),
            "cert should end with PEM footer"
        );
    }
}
