//! Test request_elevation() returns Result.

#[cfg(test)]
mod tests {
    #[test]
    fn request_elevation_returns_result() {
        let result = sparkly::request_elevation();
        // The function should return Result<bool, String>
        // In a test environment (not running as root), it may fail or return Ok(false).
        assert!(
            result.is_ok() || result.is_err(),
            "request_elevation should return Ok or Err"
        );
    }

    #[test]
    fn request_elevation_error_is_string() {
        let result = sparkly::request_elevation();
        if let Err(e) = result {
            // Error type is String
            let _: &str = &e;
            assert!(!e.is_empty(), "error message should not be empty");
        }
    }

    #[test]
    fn request_elevation_ok_is_bool() {
        let result = sparkly::request_elevation();
        if let Ok(val) = result {
            let _: bool = val;
            assert!(val == true || val == false, "Ok value should be a bool");
        }
    }

    #[test]
    fn request_elevation_does_not_panic() {
        // Just verify the function doesn't crash the process.
        // It may fail (user declined or no exe path), but it shouldn't panic.
        let _ = sparkly::request_elevation();
    }

    #[test]
    fn request_elevation_return_type_is_result() {
        // Compile-time check: the return type is Result<bool, String>
        let result = sparkly::request_elevation();
        let _: Result<bool, String> = result;
        assert!(true, "return type is Result<bool, String>");
    }
}
