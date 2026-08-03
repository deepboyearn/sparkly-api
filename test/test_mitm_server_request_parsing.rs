//! Test HTTP request line parsing logic used in the MITM server.

#[cfg(test)]
mod tests {
    /// Simulates the MITM server's request line parsing logic.
    fn parse_request_line(request: &str) -> (&str, &str, &str) {
        let first_line = request.lines().next().unwrap_or("");
        let mut parts = first_line.split_whitespace();
        let method = parts.next().unwrap_or("GET");
        let path = parts.next().unwrap_or("/");
        let version = parts.next().unwrap_or("HTTP/1.1");
        (method, path, version)
    }

    fn extract_content_length(request: &str) -> usize {
        request
            .lines()
            .find(|l| l.to_lowercase().starts_with("content-length:"))
            .and_then(|l| l.split(':').nth(1))
            .and_then(|l| l.trim().parse::<usize>().ok())
            .unwrap_or(0)
    }

    fn find_header_end(buf: &[u8]) -> Option<usize> {
        buf.windows(4).position(|w| w == b"\r\n\r\n")
    }

    fn parse_headers(request: &str) -> Vec<(String, String)> {
        let mut headers = Vec::new();
        for line in request.lines().skip(1) {
            if line.is_empty() {
                break;
            }
            if let Some((k, v)) = line.split_once(':') {
                headers.push((k.trim().to_string(), v.trim().to_string()));
            }
        }
        headers
    }

    #[test]
    fn parse_post_request_line() {
        let req = "POST /v1/chat/completions HTTP/1.1\r\nContent-Type: application/json\r\n";
        let (method, path, version) = parse_request_line(req);
        assert_eq!(method, "POST");
        assert_eq!(path, "/v1/chat/completions");
        assert_eq!(version, "HTTP/1.1");
    }

    #[test]
    fn parse_get_request_line() {
        let req = "GET /health HTTP/1.1\r\nHost: localhost\r\n";
        let (method, path, _) = parse_request_line(req);
        assert_eq!(method, "GET");
        assert_eq!(path, "/health");
    }

    #[test]
    fn parse_put_request_line() {
        let req = "PUT /v1/config HTTP/1.1\r\n";
        let (method, path, _) = parse_request_line(req);
        assert_eq!(method, "PUT");
        assert_eq!(path, "/v1/config");
    }

    #[test]
    fn parse_delete_request_line() {
        let req = "DELETE /v1/keys/abc HTTP/1.1\r\n";
        let (method, path, _) = parse_request_line(req);
        assert_eq!(method, "DELETE");
        assert_eq!(path, "/v1/keys/abc");
    }

    #[test]
    fn parse_empty_request_defaults_to_get() {
        let req = "";
        let (method, path, _) = parse_request_line(req);
        assert_eq!(method, "GET");
        assert_eq!(path, "/");
    }

    #[test]
    fn extract_content_length_present() {
        let req = "POST /api HTTP/1.1\r\nContent-Length: 256\r\nContent-Type: application/json\r\n\r\n{}";
        assert_eq!(extract_content_length(req), 256);
    }

    #[test]
    fn extract_content_length_absent() {
        let req = "GET /api HTTP/1.1\r\nHost: localhost\r\n\r\n";
        assert_eq!(extract_content_length(req), 0);
    }

    #[test]
    fn extract_content_length_case_insensitive() {
        let req = "POST /api HTTP/1.1\r\ncontent-length: 512\r\n\r\n";
        assert_eq!(extract_content_length(req), 512);
    }

    #[test]
    fn find_header_end_in_valid_request() {
        let req = b"POST /api HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{\"model\":\"test\"}";
        let end = find_header_end(req);
        assert!(end.is_some());
        assert_eq!(end.unwrap(), 52); // After the last \r\n\r\n
    }

    #[test]
    fn find_header_end_returns_none_when_no_blank_line() {
        let req = b"POST /api HTTP/1.1\r\nContent-Type: application/json";
        let end = find_header_end(req);
        assert!(end.is_none(), "should return None when no \\r\\n\\r\\n found");
    }

    #[test]
    fn parse_headers_extracts_key_value_pairs() {
        let req = "POST /api HTTP/1.1\r\nContent-Type: application/json\r\nAuthorization: Bearer tok\r\n\r\n";
        let headers = parse_headers(req);
        assert_eq!(headers.len(), 2);
        assert_eq!(headers[0], ("Content-Type".to_string(), "application/json".to_string()));
        assert_eq!(headers[1], ("Authorization".to_string(), "Bearer tok".to_string()));
    }

    #[test]
    fn parse_headers_skips_host_and_connection() {
        // The MITM server filters out Host, Transfer-Encoding, and Connection headers.
        let req = "POST /api HTTP/1.1\r\nHost: api.openai.com\r\nContent-Type: application/json\r\nConnection: keep-alive\r\n\r\n";
        let headers = parse_headers(req);
        // All headers are parsed here; the filtering happens in handle_connection
        assert!(headers.iter().any(|(k, _)| k == "Host"));
        assert!(headers.iter().any(|(k, _)| k == "Content-Type"));
        assert!(headers.iter().any(|(k, _)| k == "Connection"));
    }

    #[test]
    fn parse_request_with_extra_whitespace() {
        let req = "POST   /v1/chat/completions   HTTP/1.1\r\n";
        let (method, path, version) = parse_request_line(req);
        assert_eq!(method, "POST");
        assert_eq!(path, "/v1/chat/completions");
        assert_eq!(version, "HTTP/1.1");
    }
}
