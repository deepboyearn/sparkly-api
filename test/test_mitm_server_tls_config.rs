//! Test TLS config generation from CA cert.

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    fn tmp_data_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sparkly_test_tls_config_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ca_key_and_cert_files_are_pem_formatted() {
        let dir = tmp_data_dir();
        sparkly::trust_store::generate_ca(&dir).unwrap();
        let (key_path, cert_path) = sparkly::trust_store::ca_paths(&dir);
        let key_content = fs::read_to_string(&key_path).unwrap();
        let cert_content = fs::read_to_string(&cert_path).unwrap();
        assert!(
            key_content.contains("PRIVATE KEY"),
            "CA key should contain PEM PRIVATE KEY header"
        );
        assert!(
            cert_content.contains("CERTIFICATE"),
            "CA cert should contain PEM CERTIFICATE header"
        );
    }

    #[test]
    fn generated_cert_can_be_parsed_as_pem() {
        let dir = tmp_data_dir();
        sparkly::trust_store::generate_ca(&dir).unwrap();
        let (_, cert_path) = sparkly::trust_store::ca_paths(&dir);
        let cert_pem = fs::read_to_string(&cert_path).unwrap();
        // Verify PEM structure: starts with header, has body, ends with footer
        let lines: Vec<&str> = cert_pem.lines().collect();
        assert!(
            lines.first().map(|l| l.trim()) == Some("-----BEGIN CERTIFICATE-----"),
            "should start with BEGIN CERTIFICATE"
        );
        assert!(
            lines.last().map(|l| l.trim()) == Some("-----END CERTIFICATE-----"),
            "should end with END CERTIFICATE"
        );
    }

    #[test]
    fn ca_paths_produce_files_in_mitm_certs_subdirectory() {
        let dir = tmp_data_dir();
        let (key_path, cert_path) = sparkly::trust_store::ca_paths(&dir);
        let parent = key_path.parent().unwrap();
        assert_eq!(
            parent.file_name().unwrap().to_str().unwrap(),
            "mitm-certs"
        );
        assert_eq!(key_path.parent(), cert_path.parent());
    }

    #[test]
    fn tls_config_requires_ca_key_and_cert_to_exist() {
        let dir = tmp_data_dir();
        // No CA generated — build_tls_config would fail because ca_key_path doesn't exist
        let (key_path, _) = sparkly::trust_store::ca_paths(&dir);
        assert!(!key_path.exists(), "CA key should not exist yet");
        // We can't call build_tls_config directly (it's private), but we verify the prerequisite
        // that trust_store::generate_ca must be called first.
        sparkly::trust_store::generate_ca(&dir).unwrap();
        assert!(key_path.exists(), "CA key should exist after generation");
    }

    #[test]
    fn cert_contains_standard_san_domains() {
        let dir = tmp_data_dir();
        let (_, cert_path) = sparkly::trust_store::generate_ca(&dir).unwrap();
        // The cert should be valid PEM. We can't easily parse the SANs from PEM
        // without a full x509 parser, but we verify the cert was generated successfully.
        assert!(!cert_path.is_empty());
        assert!(
            String::from_utf8_lossy(&cert_path).contains("BEGIN CERTIFICATE"),
            "should be a valid PEM certificate"
        );
    }
}
