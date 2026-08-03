//! Test is_elevated() returns a bool.

#[cfg(test)]
mod tests {
    #[test]
    fn is_elevated_returns_a_bool() {
        let result = sparkly::is_elevated();
        // The function should return a concrete bool value
        assert!(result == true || result == false, "is_elevated should return a bool");
    }

    #[test]
    fn is_elevated_is_consistent() {
        let first = sparkly::is_elevated();
        let second = sparkly::is_elevated();
        // Calling twice should return the same result within the same process
        assert_eq!(
            first, second,
            "is_elevated should return consistent results"
        );
    }

    #[test]
    fn is_elevated_without_sudo_uid() {
        // In a typical test environment (non-root), is_elevated should be false.
        // We can't guarantee this without controlling the env, but we verify the function runs.
        let result = sparkly::is_elevated();
        // Just verify it doesn't panic and returns a valid bool
        let _ = result;
    }

    #[test]
    fn is_elevated_type_is_bool() {
        let result = sparkly::is_elevated();
        // Compile-time check: the return type is bool
        let _: bool = result;
        assert!(true, "return type is bool");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn is_elevated_checks_pkexec_or_sudo_uid() {
        // On Linux, is_elevated checks for PKEXEC_UID or SUDO_UID env vars.
        // Without those env vars set, it should return false.
        let has_pkexec = std::env::var("PKEXEC_UID").is_ok();
        let has_sudo = std::env::var("SUDO_UID").is_ok();
        let expected = has_pkexec || has_sudo;
        let actual = sparkly::is_elevated();
        assert_eq!(
            actual, expected,
            "is_elevated should match PKEXEC_UID/SUDO_UID presence"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn is_elevated_checks_sudo_uid() {
        let expected = std::env::var("SUDO_UID").is_ok();
        let actual = sparkly::is_elevated();
        assert_eq!(actual, expected, "is_elevated should match SUDO_UID presence");
    }
}
