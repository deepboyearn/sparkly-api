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
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_rustls::TlsAcceptor;

use crate::trust_store;

const MITM_DOMAINS: &[&str] = &[
    "*.googleapis.com", "*.openai.com", "api.anthropic.com",
    "api.openai.com", "api2.cursor.sh", "cloudcode-pa.googleapis.com",
    "daily-cloudcode-pa.googleapis.com", "localhost", "runtime.us-east-1.kiro.dev",
];

#[derive(Debug)]
struct CertProvider {
    ca_key_der: Vec<u8>,
    cache: HashMap<String, (rustls::pki_types::CertificateDer<'static>, rustls::pki_types::PrivateKeyDer<'static>)>,
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
    let mut ca_params = rcgen::CertificateParams::new(vec!["Sparkly API MITM CA".to_string()]).unwrap();
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

    let provider = Arc::new(tokio::sync::Mutex::new(CertProvider {
        ca_key_der,
        cache: HashMap::new(),
    }));

    let resolver = Arc::new(SniCertResolver { provider });

    let mut server_config = ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(resolver);

    server_config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    server_config.key_log = Arc::new(rustls::KeyLogFile::new());

    Ok(Arc::new(server_config))
}

#[derive(Debug)]
struct SniCertResolver {
    provider: Arc<tokio::sync::Mutex<CertProvider>>,
}

impl rustls::server::ResolvesServerCert for SniCertResolver {
    fn resolve(
        &self,
        client_hello: rustls::server::ClientHello<'_>,
    ) -> Option<Arc<rustls::sign::CertifiedKey>> {
        let mut provider = self.provider.try_lock().ok()?;
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
    model_mappings: Arc<tokio::sync::RwLock<HashMap<String, String>>>,
    upstream_url: String,
) -> Result<()> {
    let tls_config = build_tls_config(&data_dir)?;
    let acceptor = TlsAcceptor::from(tls_config);

    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("binding MITM server on port {port}"))?;

    tracing::info!("MITM server listening on port {port}, forwarding to {upstream_url}");

    tokio::spawn(async move {
        let mut shutdown_rx = shutdown_rx;
        loop {
            tokio::select! {
                accept_result = listener.accept() => {
                    match accept_result {
                        Ok((tcp_stream, peer_addr)) => {
                            let acceptor = acceptor.clone();
                            let mappings = model_mappings.clone();
                            let upstream = upstream_url.clone();
                            tokio::spawn(async move {
                                match acceptor.accept(tcp_stream).await {
                                    Ok(tls_stream) => {
                                        handle_connection(tls_stream, &mappings, &upstream).await;
                                    }
                                    Err(e) => {
                                        tracing::debug!("TLS accept error from {peer_addr}: {e}");
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            tracing::error!("TCP accept error: {e}");
                        }
                    }
                }
                _ = &mut shutdown_rx => {
                    tracing::info!("MITM server shutting down");
                    break;
                }
            }
        }
    });

    Ok(())
}

async fn handle_connection<S>(mut stream: S, model_mappings: &tokio::sync::RwLock<HashMap<String, String>>, upstream_url: &str)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let mut buf = Vec::with_capacity(4096);
    if stream.read_buf(&mut buf).await.is_err() || buf.is_empty() {
        return;
    }

    let request_str = String::from_utf8_lossy(&buf);
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

    let header_end = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .unwrap_or(buf.len());
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < content_length {
        match stream.read_buf(&mut body).await {
            Ok(0) | Err(_) => break,
            _ => {}
        }
    }

    let is_streaming = body.windows(10).position(|w| w == b"\"stream\":true").is_some()
        || body.windows(11).position(|w| w == b"\"stream\": true").is_some();

    let mut headers: Vec<(String, String)> = Vec::new();
    for line in request_str.lines().skip(1) {
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_string();
            let val = v.trim().to_string();
            if !key.eq_ignore_ascii_case("host")
                && !key.eq_ignore_ascii_case("transfer-encoding")
                && !key.eq_ignore_ascii_case("connection")
            {
                headers.push((key, val));
            }
        }
    }

    // Rewrite model name based on mappings
    let body = if !body.is_empty() {
        if let Ok(mut parsed) = serde_json::from_slice::<serde_json::Value>(&body) {
            if let Some(model) = parsed.get("model").and_then(|v| v.as_str()).map(String::from) {
                let mappings = model_mappings.read().await;
                if let Some(mapped) = mappings.get(&model) {
                    let mapped = mapped.clone();
                    drop(mappings);
                    parsed["model"] = serde_json::Value::String(mapped.clone());
                    tracing::debug!("Rewrote model: {model} → {mapped}");
                }
            }
            serde_json::to_vec(&parsed).unwrap_or(body)
        } else {
            body
        }
    } else {
        body
    };

    let upstream_url = format!("{upstream_url}{path}");

    let mut req_builder = match method {
        "POST" => reqwest::Client::new().post(&upstream_url),
        "PUT" => reqwest::Client::new().put(&upstream_url),
        "DELETE" => reqwest::Client::new().delete(&upstream_url),
        _ => reqwest::Client::new().get(&upstream_url),
    };

    for (k, v) in &headers {
        req_builder = req_builder.header(k.as_str(), v.as_str());
    }

    if !body.is_empty() {
        req_builder = req_builder.body(body);
    }

    let resp = match req_builder.send().await {
        Ok(r) => r,
        Err(e) => {
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

    let mut resp_headers = Vec::new();
    for (k, v) in resp.headers() {
        let key = k.as_str().to_string();
        let val = v.to_str().unwrap_or("").to_string();
        if !key.eq_ignore_ascii_case("transfer-encoding")
            && !key.eq_ignore_ascii_case("connection")
        {
            resp_headers.push((key, val));
        }
    }

    let status_line = format!("HTTP/1.1 {status} OK\r\n");
    let _ = stream.write_all(status_line.as_bytes()).await;

    for (k, v) in &resp_headers {
        let header = format!("{k}: {v}\r\n");
        let _ = stream.write_all(header.as_bytes()).await;
    }
    let _ = stream.write_all(b"\r\n").await;

    if is_streaming {
        match resp.bytes().await {
            Ok(raw) => {
                let text = String::from_utf8_lossy(&raw);
                for chunk in text.split("\n\n") {
                    let chunk = chunk.trim();
                    if chunk.is_empty() {
                        continue;
                    }
                    if chunk.starts_with("data: ") {
                        let _ = stream.write_all(b"data: ").await;
                        let _ = stream.write_all(chunk[6..].as_bytes()).await;
                        let _ = stream.write_all(b"\n\n").await;
                    } else {
                        let _ = stream.write_all(chunk.as_bytes()).await;
                        let _ = stream.write_all(b"\n\n").await;
                    }
                }
                let _ = stream.write_all(b"data: [DONE]\n\n").await;
            }
            Err(_) => {}
        }
    } else {
        if let Ok(body_bytes) = resp.bytes().await {
            let _ = stream.write_all(&body_bytes).await;
        }
    }

    let _ = stream.shutdown().await;
}
