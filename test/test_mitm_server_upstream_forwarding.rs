//! Test request forwarding logic used in the MITM server.

#[cfg(test)]
mod tests {
    const UPSTREAM_URL: &str = "http://127.0.0.1:48231";

    fn build_upstream_url(path: &str) -> String {
        format!("{UPSTREAM_URL}{path}")
    }

    fn select_method(method: &str, url: &str) -> String {
        // Simulates the MITM server's method selection logic
        match method {
            "POST" => format!("POST {url}"),
            "PUT" => format!("PUT {url}"),
            "DELETE" => format!("DELETE {url}"),
            _ => format!("GET {url}"),
        }
    }

    fn filter_proxy_headers(headers: Vec<(&str, &str)>) -> Vec<(String, String)> {
        headers
            .into_iter()
            .filter(|(k, _)| {
                !k.eq_ignore_ascii_case("host")
                    && !k.eq_ignore_ascii_case("transfer-encoding")
                    && !k.eq_ignore_ascii_case("connection")
            })
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn upstream_url_combines_correctly() {
        assert_eq!(build_upstream_url("/v1/chat/completions"), "http://127.0.0.1:48231/v1/chat/completions");
        assert_eq!(build_upstream_url("/health"), "http://127.0.0.1:48231/health");
        assert_eq!(build_upstream_url("/"), "http://127.0.0.1:48231/");
    }

    #[test]
    fn method_selection_post() {
        let result = select_method("POST", "/v1/chat/completions");
        assert!(result.starts_with("POST"));
        assert!(result.contains("/v1/chat/completions"));
    }

    #[test]
    fn method_selection_put() {
        let result = select_method("PUT", "/v1/config");
        assert!(result.starts_with("PUT"));
    }

    #[test]
    fn method_selection_delete() {
        let result = select_method("DELETE", "/v1/keys/abc");
        assert!(result.starts_with("DELETE"));
    }

    #[test]
    fn method_selection_get_fallback() {
        assert!(select_method("GET", "/health").starts_with("GET"));
        assert!(select_method("PATCH", "/unknown").starts_with("GET"), "unknown methods should fall back to GET");
        assert!(select_method("OPTIONS", "/cors").starts_with("GET"), "OPTIONS should fall back to GET");
    }

    #[test]
    fn filter_proxy_headers_removes_host() {
        let headers = vec![
            ("Host", "api.openai.com"),
            ("Content-Type", "application/json"),
        ];
        let filtered = filter_proxy_headers(headers);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].0, "Content-Type");
    }

    #[test]
    fn filter_proxy_headers_removes_transfer_encoding() {
        let headers = vec![
            ("Transfer-Encoding", "chunked"),
            ("Authorization", "Bearer tok"),
        ];
        let filtered = filter_proxy_headers(headers);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].0, "Authorization");
    }

    #[test]
    fn filter_proxy_headers_removes_connection() {
        let headers = vec![
            ("Connection", "keep-alive"),
            ("Accept", "*/*"),
        ];
        let filtered = filter_proxy_headers(headers);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].0, "Accept");
    }

    #[test]
    fn filter_proxy_headers_case_insensitive() {
        let headers = vec![
            ("host", "localhost"),
            ("TRANSFER-ENCODING", "chunked"),
            ("CONNECTION", "close"),
            ("Authorization", "Bearer tok"),
        ];
        let filtered = filter_proxy_headers(headers);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].0, "Authorization");
    }

    #[test]
    fn filter_proxy_headers_preserves_custom_headers() {
        let headers = vec![
            ("Content-Type", "application/json"),
            ("X-Custom-Header", "value"),
            ("Authorization", "Bearer tok"),
            ("Accept", "text/event-stream"),
        ];
        let filtered = filter_proxy_headers(headers);
        assert_eq!(filtered.len(), 4);
    }

    #[test]
    fn upstream_url_is_http_not_https() {
        assert!(
            UPSTREAM_URL.starts_with("http://"),
            "upstream should be HTTP (local proxy)"
        );
        assert!(
            !UPSTREAM_URL.starts_with("https://"),
            "upstream should NOT be HTTPS"
        );
    }
}
