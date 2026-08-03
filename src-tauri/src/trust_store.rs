// trust_store.rs — Self-signed CA cert generation + system trust store install
//
// Modeled after sparkly-api's MITM cert generation but implemented directly in Rust
// without any sparkly-api dependency. Generates a self-signed Root CA with SANs for
// common AI provider domains, then installs it into the OS trust store.

use anyhow::{Context, Result};
use rcgen::{CertificateParams, KeyPair, SanType};
use std::fs;
use std::path::{Path, PathBuf};

/// Domains the generated CA is valid for (matches sparkly-api's TARGET_HOSTS + extras).
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

/// Name used in the trust store (macOS keychain entry, Linux .crt filename, etc.)
const CA_COMMON_NAME: &str = "Sparkly API MITM CA";

/// Returns the paths where the CA key and cert are stored in the app data directory.
pub fn ca_paths(data_dir: &Path) -> (PathBuf, PathBuf) {
    let certs_dir = data_dir.join("mitm-certs");
    fs::create_dir_all(&certs_dir).ok();
    (
        certs_dir.join("rootCA.key"),
        certs_dir.join("rootCA.crt"),
    )
}

/// Check if the CA cert already exists on disk.
pub fn cert_exists(data_dir: &Path) -> bool {
    let (_, cert_path) = ca_paths(data_dir);
    cert_path.exists()
}

/// Generate a fresh self-signed Root CA (private key + x509 certificate).
/// Overwrites any existing cert pair.
pub fn generate_ca(data_dir: &Path) -> Result<(Vec<u8>, Vec<u8>)> {
    let (key_path, cert_path) = ca_paths(data_dir);

    let key_pair = KeyPair::generate()?;
    let mut params = CertificateParams::new(vec![CA_COMMON_NAME.to_string()])?;

    // Add SANs
    for d in MITM_DOMAINS {
        let name = d.replace("*.", ""); // strip wildcard prefix for basic SAN
        params.subject_alt_names.push(SanType::DnsName(name.parse().unwrap()));
    }

    // Make this a CA certificate
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);

    let cert = params.self_signed(&key_pair)?;

    let key_pem = key_pair.serialize_pem();
    let cert_pem = cert.pem();

    fs::write(&key_path, &key_pem).context("writing CA key")?;
    fs::write(&cert_path, &cert_pem).context("writing CA cert")?;

    // Lock down permissions on the key (0600)
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let _ = fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(&key_path);
    }

    Ok((key_pem.into_bytes(), cert_pem.into_bytes()))
}

/// Read the existing CA cert PEM bytes, or generate fresh if missing.
pub fn get_or_generate_ca(data_dir: &Path) -> Result<(Vec<u8>, Vec<u8>)> {
    let (key_path, cert_path) = ca_paths(data_dir);
    if key_path.exists() && cert_path.exists() {
        let key = fs::read(&key_path).context("reading CA key")?;
        let cert = fs::read(&cert_path).context("reading CA cert")?;
        return Ok((key, cert));
    }
    generate_ca(data_dir)
}

/// Check whether the CA cert is currently trusted in the OS trust store.
pub fn is_trusted(data_dir: &Path) -> bool {
    let (_, cert_path) = ca_paths(data_dir);
    if !cert_path.exists() {
        return false;
    }

    #[cfg(target_os = "linux")]
    {
        let installed = PathBuf::from("/usr/local/share/ca-certificates/sparkly-api-mitm-ca.crt");
        if installed.exists() {
            // Verify the installed cert matches ours
            let ours = fs::read(&cert_path).unwrap_or_default();
            let installed_data = fs::read(&installed).unwrap_or_default();
            return ours == installed_data;
        }
        return false;
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("security")
            .args(["find-certificate", "-c", CA_COMMON_NAME, "-a", "-p"])
            .output();
        match output {
            Ok(o) => o.status.success() && !o.stdout.is_empty(),
            Err(_) => false,
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("certutil")
            .args(["-verifystore", "root", CA_COMMON_NAME])
            .output();
        match output {
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                stderr.contains("CmdResult: 0x0")
                    || o.stdout.windows(b"CertUtil".len()).any(|w| w == b"CertUtil")
            }
            Err(_) => false,
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

/// Install the CA cert into the OS trust store.
/// Returns Ok(true) on success, Ok(false) if already trusted.
pub fn trust(data_dir: &Path) -> Result<bool> {
    let (_, cert_path) = ca_paths(data_dir);
    if !cert_path.exists() {
        anyhow::bail!("CA cert not found at {}", cert_path.display());
    }
    if is_trusted(data_dir) {
        return Ok(false); // already trusted
    }

    #[cfg(target_os = "linux")]
    {
        let dest = "/usr/local/share/ca-certificates/sparkly-api-mitm-ca.crt";
        fs::copy(&cert_path, dest).context("copying CA cert to system directory")?;
        let output = std::process::Command::new("sudo")
            .args(["update-ca-certificates"])
            .output()
            .context("running update-ca-certificates")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("update-ca-certificates failed: {stderr}");
        }
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("sudo")
            .args([
                "security",
                "add-trusted-cert",
                "-d",
                "-r",
                "trustRoot",
                "-k",
                "/Library/Keychains/System.keychain",
                cert_path.to_str().unwrap_or(""),
            ])
            .output()
            .context("running security add-trusted-cert")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to add cert: {stderr}");
        }
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("certutil")
            .args(["-addstore", "root", cert_path.to_str().unwrap_or("")])
            .output()
            .context("running certutil -addstore")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to add cert: {stderr}");
        }
        return Ok(true);
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        anyhow::bail!("Unsupported platform for trust store installation");
    }
}

/// Remove the CA cert from the OS trust store.
pub fn untrust(data_dir: &Path) -> Result<bool> {
    if !is_trusted(data_dir) {
        return Ok(false); // not trusted
    }

    #[cfg(target_os = "linux")]
    {
        let installed = PathBuf::from("/usr/local/share/ca-certificates/sparkly-api-mitm-ca.crt");
        if installed.exists() {
            let _ = fs::remove_file(&installed);
        }
        let output = std::process::Command::new("sudo")
            .args(["update-ca-certificates", "--fresh"])
            .output()
            .context("running update-ca-certificates --fresh")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("update-ca-certificates failed: {stderr}");
        }
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("sudo")
            .args([
                "security",
                "remove-trusted-cert",
                "-d",
                cert_path.to_str().unwrap_or(""),
            ])
            .output()
            .context("running security remove-trusted-cert")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to remove cert: {stderr}");
        }
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("certutil")
            .args(["-delstore", "root", CA_COMMON_NAME])
            .output()
            .context("running certutil -delstore")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to remove cert: {stderr}");
        }
        return Ok(true);
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        anyhow::bail!("Unsupported platform for trust store removal");
    }
}
