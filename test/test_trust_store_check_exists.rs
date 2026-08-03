//! Test cert_exists() for missing and existing certs.

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    fn tmp_data_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sparkly_test_exists_{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn cert_exists_returns_false_when_no_data_dir() {
        let dir = tmp_data_dir();
        // No CA generated — cert_exists should return false
        assert!(
            !sparkly::trust_store::cert_exists(&dir),
            "cert_exists should be false when no CA has been generated"
        );
    }

    #[test]
    fn cert_exists_returns_true_after_generation() {
        let dir = tmp_data_dir();
        sparkly::trust_store::generate_ca(&dir).unwrap();
        assert!(
            sparkly::trust_store::cert_exists(&dir),
            "cert_exists should be true after generate_ca"
        );
    }

    #[test]
    fn cert_exists_returns_false_for_empty_dir() {
        let dir = tmp_data_dir();
        // Create the mitm-certs dir manually but don't write any files
        let (_, cert_path) = sparkly::trust_store::ca_paths(&dir);
        assert!(
            !sparkly::trust_store::cert_exists(&dir),
            "cert_exists should be false when mitm-certs dir has no .crt"
        );
    }

    #[test]
    fn cert_exists_returns_false_when_key_exists_but_cert_does_not() {
        let dir = tmp_data_dir();
        let (key_path, _) = sparkly::trust_store::ca_paths(&dir);
        // Write only the key file
        fs::write(&key_path, "fake key").unwrap();
        assert!(
            !sparkly::trust_store::cert_exists(&dir),
            "cert_exists should be false when only key file exists"
        );
    }

    #[test]
    fn cert_exists_returns_false_after_deleting_cert_file() {
        let dir = tmp_data_dir();
        sparkly::trust_store::generate_ca(&dir).unwrap();
        assert!(sparkly::trust_store::cert_exists(&dir));
        let (_, cert_path) = sparkly::trust_store::ca_paths(&dir);
        fs::remove_file(&cert_path).unwrap();
        assert!(
            !sparkly::trust_store::cert_exists(&dir),
            "cert_exists should be false after deleting the cert file"
        );
    }

    #[test]
    fn cert_exists_is_consistent_across_calls() {
        let dir = tmp_data_dir();
        let first = sparkly::trust_store::cert_exists(&dir);
        let second = sparkly::trust_store::cert_exists(&dir);
        assert_eq!(first, second, "cert_exists should be deterministic");
    }
}
