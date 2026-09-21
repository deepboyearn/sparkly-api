// mitm_server.rs — MITM HTTPS proxy server
//
// Listens on port 443, intercepts TLS via SNI-based dynamic cert generation,
// forwards HTTP requests to the Sparkly API backend.

use anyhow::{Context, Result};
use rustls::ServerConfig;
use std::collections::HashMap;
use std::io::BufReader;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, LazyLock};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_rustls::TlsAcceptor;

use crate::trust_store;

const MAX_MITM_REQUEST_BYTES: usize = 32 * 1024 * 1024;
const MAX_MITM_HEADER_BYTES: usize = 64 * 1024;
const MAX_MITM_CONNECTIONS: usize = 64;
const MITM_IO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

static MITM_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .pool_max_idle_per_host(8)
        .build()
        .expect("building the shared MITM HTTP client")
});

const MITM_DOMAINS: &[&str] = &[
    "*.googleapis.com",
    "*.openai.com",
    "api.anthropic.com",
    "api.openai.com",
    "api2.cursor.sh",
    "cloudcode-pa.googleapis.com",
    "daily-cloudcode-pa.googleapis.com",
    "localhost",
    "runtime.us-east-1.kiro.dev",
];

#[derive(Debug)]
struct CertProvider {
    ca_key_der: Vec<u8>,
    cache: HashMap<
        String,
        (
            rustls::pki_types::CertificateDer<'static>,
            rustls::pki_types::PrivateKeyDer<'static>,
        ),
    >,
}

/// Reconstruct the CA cert params (deterministic from known domain list + CN)
/// and use it to sign a domain cert.
fn cert_der_for_domain(provider: &mut CertProvider, domain: &str) -> Vec<u8> {
    if let Some((cert, _)) = provider.cache.get(domain) {
        return cert.to_vec();
    }

    // Reconstruct CA key pair from stored DER
    let ca_key_pair = rcgen::KeyPair::try_from(provider.ca_key_der.as_slice()).unwrap();

    // Reconstruct CA cert (deterministic params = same cert every time)
    let mut ca_params =
        rcgen::CertificateParams::new(vec!["Sparkly API MITM CA".to_string()]).unwrap();
    ca_params.subject_alt_names = MITM_DOMAINS
        .iter()
        .map(|d| rcgen::SanType::DnsName(d.replace("*.", "").parse().unwrap()))
        .collect();
    ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    let ca_cert = ca_params.self_signed(&ca_key_pair).unwrap();

    // Generate domain cert signed by CA
    let mut params = rcgen::CertificateParams::new(vec![domain.to_string()]).unwrap();
    params.subject_alt_names = vec![rcgen::SanType::DnsName(domain.parse().unwrap())];

    let key_pair = rcgen::KeyPair::generate().unwrap();
    let cert = params.signed_by(&ca_key_pair, &ca_cert, &key_pair).unwrap();

    let cert_der = cert.der().to_vec();
    let key_der = key_pair.serialize_der();

    provider.cache.insert(
        domain.to_string(),
        (
            cert_der.clone().into(),
            rustls::pki_types::PrivateKeyDer::Pkcs8(key_der.into()),
        ),
    );
    cert_der
}

fn build_tls_config(data_dir: &Path) -> Result<Arc<ServerConfig>> {
    let (ca_key_path, _) = trust_store::ca_paths(data_dir);

    let ca_key_pem = std::fs::read_to_string(&ca_key_path)
        .with_context(|| format!("reading CA key at {}", ca_key_path.display()))?;

    // Parse CA key DER from PEM
    let mut reader = BufReader::new(ca_key_pem.as_bytes());
    let mut ca_key_items = rustls_pemfile::pkcs8_private_keys(&mut reader);
    let pkcs8_key = ca_key_items
        .next()
        .ok_or_else(|| anyhow::anyhow!("no private key in CA PEM"))?
        .map_err(|e| anyhow::anyhow!("reading CA key: {e}"))?;
    let ca_key_der = pkcs8_key.secret_pkcs8_der().to_vec();

    let provider = Arc::new(parking_lot::Mutex::new(CertProvider {
        ca_key_der,
        cache: HashMap::new(),
    }));

    let resolver = Arc::new(SniCertResolver { provider });

    let mut server_config = ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(resolver);

    // The current forwarding layer accepts HTTP/1.1 only. Never advertise h2
    // until the connection handler is backed by Hyper's HTTP/2 implementation.
    server_config.alpn_protocols = vec![b"http/1.1".to_vec()];

    Ok(Arc::new(server_config))
}

#[derive(Debug)]
struct SniCertResolver {
    provider: Arc<parking_lot::Mutex<CertProvider>>,
}

impl rustls::server::ResolvesServerCert for SniCertResolver {
    fn resolve(
        &self,
        client_hello: rustls::server::ClientHello<'_>,
    ) -> Option<Arc<rustls::sign::CertifiedKey>> {
        let mut provider = self.provider.lock();
        let domain = client_hello.server_name()?.to_string();
        cert_der_for_domain(&mut provider, &domain);

        let (cert_der, key_der) = provider.cache.get(&domain)?;

        let signing_key = rustls::crypto::ring::sign::any_supported_type(key_der).ok()?;
        let certified_key = rustls::sign::CertifiedKey::new(vec![cert_der.clone()], signing_key);
        Some(Arc::new(certified_key))
    }
}

pub async fn start_mitm_server(
    data_dir: std::path::PathBuf,
    port: u16,
    shutdown_rx: oneshot::Receiver<()>,
    ready_tx: oneshot::Sender<Result<(), String>>,
    model_mappings: Arc<tokio::sync::RwLock<HashMap<String, String>>>,
    upstream_url: String,
) -> Result<()> {
    let tls_config = match build_tls_config(&data_dir) {
        Ok(config) => config,
        Err(error) => {
            let message = error.to_string();
            let _ = ready_tx.send(Err(message.clone()));
            return Err(error);
        }
    };
    let acceptor = TlsAcceptor::from(tls_config);

    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = match TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(error) => {
            let message = format!("Cannot bind localhost:{port}: {error}");
            let _ = ready_tx.send(Err(message.clone()));
            return Err(error).with_context(|| format!("binding MITM server on localhost:{port}"));
        }
    };

    tracing::info!("MITM server listening on localhost:{port}, forwarding to {upstream_url}");
    let _ = ready_tx.send(Ok(()));

    let connection_limit = Arc::new(tokio::sync::Semaphore::new(MAX_MITM_CONNECTIONS));
    let mut shutdown_rx = shutdown_rx;
    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((tcp_stream, peer_addr)) => {
                        let permit = match connection_limit.clone().try_acquire_owned() {
                            Ok(permit) => permit,
                            Err(_) => {
                                tracing::warn!("MITM connection limit reached; rejecting {peer_addr}");
                                drop(tcp_stream);
                                continue;
                            }
                        };
                        let acceptor = acceptor.clone();
                        let mappings = model_mappings.clone();
                        let upstream = upstream_url.clone();
                        tokio::spawn(async move {
                            let _permit = permit;
                            let mut tcp_stream = tcp_stream;
                            let peer_label = peer_addr.to_string();
                            let request_id = format!("mitm-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());

                            match tokio::time::timeout(
                                std::time::Duration::from_secs(5),
                                accept_connect_tunnel(&mut tcp_stream, &peer_label, &request_id),
                            ).await {
                                Ok(Ok(is_connect)) => tracing::info!("[MITM][{request_id}] TCP connection accepted from {peer_label} (connect={is_connect})"),
                                Ok(Err(error)) => {
                                    tracing::warn!("[MITM][{request_id}] CONNECT handshake failed from {peer_label}: {error}");
                                    return;
                                }
                                Err(_) => {
                                    tracing::warn!("[MITM][{request_id}] CONNECT handshake timed out from {peer_label}");
                                    return;
                                }
                            }

                            match tokio::time::timeout(std::time::Duration::from_secs(10), acceptor.accept(tcp_stream)).await {
                                Ok(Ok(tls_stream)) => handle_connection(tls_stream, &mappings, &upstream, &request_id).await,
                                Ok(Err(error)) => tracing::warn!("[MITM][{request_id}] TLS accept error from {peer_label}: {error}"),
                                Err(_) => tracing::warn!("[MITM][{request_id}] TLS handshake timed out for {peer_label}"),
                            }
                        });
                    }
                    Err(error) => tracing::error!("TCP accept error: {error}"),
                }
            }
            _ = &mut shutdown_rx => {
                tracing::info!("MITM server shutting down");
                break;
            }
        }
    }

    Ok(())
}

async fn accept_connect_tunnel(
    stream: &mut tokio::net::TcpStream,
    peer: &str,
    request_id: &str,
) -> Result<bool> {
    let mut prefix = [0_u8; 7];
    let read = stream.peek(&mut prefix).await?;
    if read < prefix.len() || &prefix != b"CONNECT" {
        return Ok(false);
    }

    let mut header = Vec::with_capacity(256);
    loop {
        let byte = stream.read_u8().await?;
        header.push(byte);
        if header.len() >= 4 && header[header.len() - 4..] == *b"\r\n\r\n" {
            break;
        }
        if header.len() > MAX_MITM_HEADER_BYTES {
            anyhow::bail!("CONNECT header too large");
        }
    }

    let text = String::from_utf8_lossy(&header);
    let authority = text.lines().next().unwrap_or("CONNECT unknown:443");
    tracing::info!("[MITM][{request_id}] CONNECT tunnel requested by {peer}: {authority}");
    stream
        .write_all(b"HTTP/1.1 200 Connection Established\r\nProxy-Agent: Sparkly-MITM\r\n\r\n")
        .await?;
    Ok(true)
}

fn is_streaming_body(body: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value.get("stream").and_then(|stream| stream.as_bool()))
        .unwrap_or(false)
}

async fn handle_connection<S>(
    mut stream: S,
    model_mappings: &tokio::sync::RwLock<HashMap<String, String>>,
    upstream_url: &str,
    request_id: &str,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut buf = Vec::with_capacity(8192);
    let header_end = loop {
        if let Some(position) = buf.windows(4).position(|window| window == b"\r\n\r\n") {
            break position;
        }
        if buf.len() >= MAX_MITM_HEADER_BYTES {
            let _ = stream.write_all(
                b"HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
            ).await;
            let _ = stream.shutdown().await;
            return;
        }
        match tokio::time::timeout(MITM_IO_TIMEOUT, stream.read_buf(&mut buf)).await {
            Ok(Ok(read)) if read > 0 => {}
            _ => return,
        }
    };
    let request_str = String::from_utf8_lossy(&buf[..header_end]);
    let first_line = request_str.lines().next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let path = parts.next().unwrap_or("/");

    let content_length = request_str
        .lines()
        .find(|l| l.to_lowercase().starts_with("content-length:"))
        .and_then(|l| l.split(':').nth(1))
        .and_then(|l| l.trim().parse::<usize>().ok())
        .unwrap_or(0);

    if content_length > MAX_MITM_REQUEST_BYTES {
        let _ = stream
            .write_all(
                b"HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
            )
            .await;
        let _ = stream.shutdown().await;
        return;
    }

    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < content_length {
        match tokio::time::timeout(MITM_IO_TIMEOUT, stream.read_buf(&mut body)).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => break,
            Ok(Ok(_)) => {
                if body.len() > MAX_MITM_REQUEST_BYTES {
                    let _ = stream.shutdown().await;
                    return;
                }
            }
        }
    }
    if body.len() != content_length {
        let _ = stream
            .write_all(
                b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
            )
            .await;
        let _ = stream.shutdown().await;
        return;
    }
    body.truncate(content_length);

    let is_streaming = is_streaming_body(&body);

    let mut headers: Vec<(String, String)> = Vec::new();
    for line in request_str.lines().skip(1) {
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_string();
            let val = v.trim().to_string();
            if !key.eq_ignore_ascii_case("host")
                && !key.eq_ignore_ascii_case("content-length")
                && !key.eq_ignore_ascii_case("transfer-encoding")
                && !key.eq_ignore_ascii_case("connection")
            {
                headers.push((key, val));
            }
        }
    }

    // Rewrite model name based on mappings
    let original_model: Option<String> = if !body.is_empty() {
        serde_json::from_slice::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(String::from))
    } else {
        None
    };
    tracing::info!(
        "[MITM][{request_id}] Incoming request: {method} {path} | body={}B | source_model={:?}",
        body.len(),
        original_model
    );

    let body = if !body.is_empty() {
        if let Ok(mut parsed) = serde_json::from_slice::<serde_json::Value>(&body) {
            if let Some(ref model) = original_model {
                let mappings = model_mappings.read().await;
                tracing::info!(
                    "[MITM] Incoming request: {method} {path} | source model: '{model}' | {} mappings loaded",
                    mappings.len()
                );
                if let Some(mapped) = mappings.get(model) {
                    let mapped = mapped.clone();
                    drop(mappings);
                    tracing::info!("[MITM] ✅ Model rewrite: '{model}' → '{mapped}'");
                    parsed["model"] = serde_json::Value::String(mapped);
                } else {
                    tracing::warn!(
                        "[MITM] ⚠️  No mapping found for model '{model}'. Available mappings: {:?}. Request will pass through with original model name.",
                        mappings.keys().collect::<Vec<_>>()
                    );
                    drop(mappings);
                }
            } else {
                tracing::info!(
                    "[MITM] Incoming request: {method} {path} | no 'model' field in body"
                );
            }
            serde_json::to_vec(&parsed).unwrap_or(body)
        } else {
            tracing::info!("[MITM] Incoming request: {method} {path} | body is not JSON");
            body
        }
    } else {
        tracing::info!("[MITM] Incoming request: {method} {path} | empty body");
        body
    };

    let upstream_full_url = format!("{upstream_url}/v1/chat/completions");
    tracing::info!("[MITM][{request_id}] Forwarding mapped request → POST {upstream_full_url}");

    let mut req_builder = match method {
        "POST" => MITM_HTTP_CLIENT.post(&upstream_full_url),
        "PUT" => MITM_HTTP_CLIENT.put(&upstream_full_url),
        "PATCH" => MITM_HTTP_CLIENT.patch(&upstream_full_url),
        "DELETE" => MITM_HTTP_CLIENT.delete(&upstream_full_url),
        "HEAD" => MITM_HTTP_CLIENT.head(&upstream_full_url),
        _ => MITM_HTTP_CLIENT.get(&upstream_full_url),
    };

    for (k, v) in &headers {
        req_builder = req_builder.header(k.as_str(), v.as_str());
    }
    // The bridge is a local protected API. These headers identify traffic that
    // arrived through the local MITM and allow it to authenticate internally.
    req_builder = req_builder
        .header("x-sparkly-mitm", "1")
        .header("x-sparkly-source", "antigravity")
        .header("x-sparkly-request-id", request_id);

    if !body.is_empty() {
        req_builder = req_builder.body(body);
    }

    let mut resp = match req_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("[MITM][{request_id}] Upstream request FAILED: POST {upstream_full_url} | error: {e}");
            let err_body = format!(
                "{{\"error\":{{\"message\":\"{}\",\"type\":\"upstream_error\"}}}}",
                e
            );
            let resp_line = b"HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(resp_line).await;
            let _ = stream.write_all(err_body.as_bytes()).await;
            let _ = stream.shutdown().await;
            return;
        }
    };

    let status = resp.status().as_u16();
    if status >= 400 {
        tracing::warn!(
            "[MITM][{request_id}] Upstream returned HTTP {status} for POST {upstream_full_url}"
        );
    } else {
        tracing::info!(
            "[MITM][{request_id}] Upstream response: HTTP {status} for POST {upstream_full_url}"
        );
    }

    let mut resp_headers = Vec::new();
    for (k, v) in resp.headers() {
        let key = k.as_str().to_string();
        let val = v.to_str().unwrap_or("").to_string();
        if !key.eq_ignore_ascii_case("transfer-encoding")
            && !key.eq_ignore_ascii_case("connection")
            && !(is_streaming && key.eq_ignore_ascii_case("content-length"))
        {
            resp_headers.push((key, val));
        }
    }

    let reason = resp.status().canonical_reason().unwrap_or("");
    let status_line = format!("HTTP/1.1 {status} {reason}\r\n");
    let _ = stream.write_all(status_line.as_bytes()).await;

    for (k, v) in &resp_headers {
        let header = format!("{k}: {v}\r\n");
        let _ = stream.write_all(header.as_bytes()).await;
    }
    let _ = stream.write_all(b"Connection: close\r\n\r\n").await;

    if is_streaming {
        loop {
            match tokio::time::timeout(MITM_IO_TIMEOUT, resp.chunk()).await {
                Ok(Ok(Some(chunk))) => {
                    if stream.write_all(&chunk).await.is_err() {
                        break;
                    }
                }
                Ok(Ok(None)) => break,
                Ok(Err(error)) => {
                    tracing::debug!("MITM upstream stream failed: {error}");
                    break;
                }
                Err(_) => {
                    tracing::debug!("MITM upstream stream timed out");
                    break;
                }
            }
        }
    } else if let Ok(body_bytes) = resp.bytes().await {
        let _ = stream.write_all(&body_bytes).await;
    }

    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_json_streaming_without_whitespace_assumptions() {
        assert!(is_streaming_body(br#"{"stream" : true}"#));
        assert!(!is_streaming_body(br#"{"stream":false}"#));
        assert!(!is_streaming_body(br#"{"message":"stream:true"}"#));
        assert!(!is_streaming_body(b"not-json"));
    }
}
