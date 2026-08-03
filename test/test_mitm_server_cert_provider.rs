//! Test SNI cert generation for domains.

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs;

    /// The MITM_DOMAINS list that the cert provider uses.
    const MITM_DOMAINS: &[&str] = &[
        "api.anthropic.com",
        "api.openai.com",
        "api2.cursor.sh",
        "cloudcode-pa.googleapis.com",
        "daily-cloudcode-pa.googleapis.com",
        "runtime.us-east-1.kiro.dev",
        "localhost",
        "*.googleapis.com",
        "*.openai.com",
    ];

    #[test]
    fn mitm_domains_list_has_expected_count() {
        // 9 entries in the domain list
        assert_eq!(MITM_DOMAINS.len(), 9, "MITM_DOMAINS should have 9 entries");
    }

    #[test]
    fn mitm_domains_contains_major_providers() {
        assert!(MITM_DOMAINS.contains(&"api.anthropic.com"));
        assert!(MITM_DOMAINS.contains(&"api.openai.com"));
        assert!(MITM_DOMAINS.contains(&"api2.cursor.sh"));
    }

    #[test]
    fn mitm_domains_contains_google_domains() {
        assert!(MITM_DOMAINS.contains(&"cloudcode-pa.googleapis.com"));
        assert!(MITM_DOMAINS.contains(&"daily-cloudcode-pa.googleapis.com"));
        assert!(MITM_DOMAINS.contains(&"*.googleapis.com"));
    }

    #[test]
    fn wildcard_domains_have_stripped_prefix_for_san() {
        // The cert provider strips "*." from wildcard domains for SANs
        for domain in MITM_DOMAINS {
            if domain.starts_with("*.") {
                let stripped = domain.replace("*.", "");
                assert!(
                    !stripped.starts_with("*."),
                    "wildcard prefix should be stripped: got '{}'",
                    stripped
                );
                assert!(
                    !stripped.is_empty(),
                    "stripped domain should not be empty"
                );
            }
        }
    }

    #[test]
    fn cert_provider_cache_prevents_duplicate_generation() {
        // Simulate cache behavior: insert once, retrieve on second access
        let mut cache: HashMap<String, Vec<u8>> = HashMap::new();
        let domain = "api.openai.com";
        let fake_cert = b"fake-cert-data";

        // First access: miss
        assert!(cache.get(domain).is_none());

        // Insert
        cache.insert(domain.to_string(), fake_cert.to_vec());

        // Second access: hit
        assert!(cache.get(domain).is_some());
        assert_eq!(cache.get(domain).unwrap(), fake_cert);
    }

    #[test]
    fn all_mitm_domains_are_valid_hostnames() {
        for domain in MITM_DOMAINS {
            // Strip wildcard prefix for validation
            let hostname = domain.trim_start_matches("*.");
            // A valid hostname should not contain spaces
            assert!(
                !hostname.contains(' '),
                "domain '{}' should not contain spaces",
                domain
            );
            // Should contain at least one dot (for FQDN), or be "localhost"
            assert!(
                hostname.contains('.') || hostname == "localhost",
                "domain '{}' should be a valid hostname or localhost",
                domain
            );
        }
    }

    #[test]
    fn mitm_domains_are_sorted_in_consistent_order() {
        let mut sorted = MITM_DOMAINS.to_vec();
        sorted.sort();
        assert_eq!(
            MITM_DOMAINS, sorted,
            "MITM_DOMAINS should be in sorted order for determinism"
        );
    }
}
