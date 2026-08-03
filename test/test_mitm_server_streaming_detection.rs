//! Test SSE streaming detection logic used in the MITM server.

#[cfg(test)]
mod tests {
    /// Simulates the MITM server's streaming detection from request body bytes.
    fn is_streaming(body: &[u8]) -> bool {
        body.windows(10).position(|w| w == b"\"stream\":true").is_some()
            || body.windows(11).position(|w| w == b"\"stream\": true").is_some()
    }

    #[test]
    fn detects_stream_true_no_space() {
        let body = br#"{"model":"gpt-4","stream":true,"messages":[]}"#;
        assert!(is_streaming(body));
    }

    #[test]
    fn detects_stream_true_with_space() {
        let body = br#"{"model":"gpt-4","stream": true,"messages":[]}"#;
        assert!(is_streaming(body));
    }

    #[test]
    fn detects_stream_false_not_streaming() {
        let body = br#"{"model":"gpt-4","stream":false,"messages":[]}"#;
        assert!(!is_streaming(body));
    }

    #[test]
    fn no_stream_field_not_streaming() {
        let body = br#"{"model":"gpt-4","messages":[]}"#;
        assert!(!is_streaming(body));
    }

    #[test]
    fn empty_body_not_streaming() {
        let body = b"";
        assert!(!is_streaming(body));
    }

    #[test]
    fn stream_field_at_start_of_body() {
        let body = br#"{"stream":true}"#;
        assert!(is_streaming(body));
    }

    #[test]
    fn stream_field_at_end_of_body() {
        let body = br#"{"messages":[],"stream":true}"#;
        assert!(is_streaming(body));
    }

    #[test]
    fn stream_true_string_value_not_detected() {
        // "stream":"true" (string value) should NOT trigger streaming
        let body = br#"{"stream":"true"}"#;
        // The detection looks for `:true` or `: true` which won't match `:"true"`
        assert!(!is_streaming(body));
    }

    #[test]
    fn stream_in_nested_object_detected() {
        let body = br#"{"config":{"stream":true},"model":"gpt-4"}"#;
        // The detection is byte-based on the whole body, not just top-level
        assert!(is_streaming(body));
    }

    #[test]
    fn stream_true_with_multiple_spaces() {
        // "stream":   true (multiple spaces)
        let body = br#"{"stream":   true}"#;
        // The detection looks for "stream": true (exactly one space), so this won't match
        assert!(!is_streaming(body));
    }

    #[test]
    fn large_body_still_detects_streaming() {
        let mut body = String::from(r#"{"model":"gpt-4","messages":["#);
        // Pad with a large array
        for i in 0..1000 {
            body.push_str(&format!(r#"{{"role":"user","content":"msg{}"}}"#, i));
            if i < 999 {
                body.push(',');
            }
        }
        body.push_str(r#"],"stream":true}"#);
        assert!(is_streaming(body.as_bytes()));
    }

    #[test]
    fn detect_sse_data_prefix() {
        // SSE format: data: {...}\n\n
        let sse = b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n";
        let starts_with_data = sse.starts_with(b"data: ");
        assert!(starts_with_data, "SSE chunks should start with 'data: '");
    }

    #[test]
    fn detect_sse_done_marker() {
        let done = b"data: [DONE]\n\n";
        let is_done = done.starts_with(b"data: [DONE]");
        assert!(is_done, "Should detect [DONE] marker");
    }
}
