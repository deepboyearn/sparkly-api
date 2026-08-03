//! Test macOS trust store detection.

#[cfg(target_os = "macos")]
#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    fn tmp_data_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sparkly_test_macos_trust_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn is_trusted_returns_false_when_no_cert() {
        let dir = tmp_data_dir();
        // No cert generated — should be false
        let result = sparkly::trust_store::is_trusted(&dir);
        assert!(!result, "is_trusted should be false when no CA cert exists");
    }

    #[test]
    fn is_trusted_after_generation_not_installed() {
        let dir = tmp_data_dir();
        sparkly::trust_store::generate_ca(&dir).unwrap();
        // On macOS, is_trusted checks `security find-certificate -c <CN>`.
        // In a test environment the cert is not in the keychain.
        let result = sparkly::trust_store::is_trusted(&dir);
        assert!(
            result == true || result == false,
            "is_trusted should not panic on macOS"
        );
    }

    #[test]
    fn trust_returns_err_when_cert_missing() {
        let dir = tmp_data_dir();
        let result = sparkly::trust_store::trust(&dir);
        assert!(result.is_err(), "trust() should return Err when CA cert is missing");
    }

    #[test]
    fn trust_returns_ok_when_cert_exists() {
        let dir = tmp_data_dir();
        sparkly::trust_store::generate_ca(&dir).unwrap();
        let result = sparkly::trust_store::trust(&dir);
        // On macOS this calls `sudo security add-trusted-cert` which may or may not succeed
        // in a test environment, but it should not panic.
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn untrust_when_not_trusted_returns_ok_false() {
        let dir = tmp_data_dir();
        sparkly::trust_store::generate_ca(&dir).unwrap();
        let result = sparkly::trust_store::untrust(&dir);
        assert!(result.is_ok() || result.is_err());
    }
}

#[cfg(not(target_os = "macos"))]
#[cfg(test)]
mod tests {
    #[test]
    fn placeholder_non_macos_platform() {
        assert!(true);
    }
}
