import { useState, useEffect } from "react";
import { Icon } from "@iconify/react/offline";
import logo from "../../../logo/logp.png";

const AG_MODELS = [
  "Gemini 3.6 Flash (High)",
  "Gemini 3.6 Flash (Medium)",
  "Gemini 3.6 Flash (Low)",
  "Gemini 3.5 Flash (Medium) / Default",
  "Gemini 3.5 Flash (High)",
  "Gemini 3.5 Flash (Low)",
  "Gemini 3.1 Pro (Low)",
  "Gemini 3.1 Pro (High)",
  "Claude Sonnet 4.6 (Thinking)",
  "Claude Opus 4.6 (Thinking)",
  "GPT-OSS 120B (Medium)",
  "Gemini 3 Flash (Command)",
];

export default function MITMPage() {
  const [baseUrl, setBaseUrl] = useState("http://localhost:20128");
  const [apiKey, setApiKey] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isCertTrusted, setIsCertTrusted] = useState(false);
  const [isCertGenerated, setIsCertGenerated] = useState(true);
  const [certLoading, setCertLoading] = useState(false);

  // Antigravity Card State
  const [isAgExpanded, setIsAgExpanded] = useState(true);
  const [isDnsStarted, setIsDnsStarted] = useState(false);
  const [modelMappings, setModelMappings] = useState<Record<string, string>>({});

  // Check cert status and load model mappings on mount
  useEffect(() => {
    const init = async () => {
      try {
        const api = (window as unknown as Record<string, unknown>).bridgeApi as Record<string, (...args: unknown[]) => Promise<unknown>>;
        // Check cert status
        if (api?.getMitmCertStatus) {
          const status = (await api.getMitmCertStatus()) as { exists: boolean; trusted: boolean };
          setIsCertGenerated(status.exists);
          setIsCertTrusted(status.trusted);
        }
        // Load model mappings
        if (api?.getMitmModelMappings) {
          const mappings = (await api.getMitmModelMappings()) as Record<string, string>;
          setModelMappings(mappings);
        }
      } catch (err) {
        console.error("Failed to initialize MITM page:", err);
      }
    };
    init();
  }, []);

  const [serverLoading, setServerLoading] = useState(false);

  const toggleServer = async () => {
    setServerLoading(true);
    try {
      const api = (window as unknown as Record<string, unknown>).bridgeApi as Record<string, (...args: unknown[]) => Promise<unknown>>;
      if (isRunning) {
        await api.stopMitmServer();
        setIsRunning(false);
      } else {
        await api.startMitmServer();
        setIsRunning(true);
      }
    } catch (err: unknown) {
      console.error("Failed to toggle MITM server:", err);
      const msg = String(err);
      if (msg.includes("ADMIN_ELEVATION_REQUESTED")) {
        // Windows UAC popup was shown — the elevated instance will take over
        alert("Admin elevation requested. A new elevated window will open. Close this one.");
      } else if (msg.includes("root")) {
        alert(msg); // Linux: "Port 443 requires root. Run with: sudo ./sparkly-api"
      } else {
        alert(`MITM server error: ${msg}`);
      }
    } finally {
      setServerLoading(false);
    }
  };

  const handleTrustCert = async () => {
    setCertLoading(true);
    try {
      const api = (window as unknown as Record<string, unknown>).bridgeApi as Record<string, (...args: unknown[]) => Promise<unknown>>;
      if (api?.trustMitmCert) {
        await api.trustMitmCert();
        setIsCertTrusted(true);
        setIsCertGenerated(true);
      } else {
        // Fallback for browser mode
        setIsCertTrusted(true);
      }
    } catch (err: unknown) {
      console.error("Failed to trust cert:", err);
      const msg = String(err);
      if (msg.includes("ADMIN_ELEVATION_REQUESTED")) {
        alert("Admin elevation requested. A new elevated window will open. Close this one.");
      } else {
        alert(`Certificate trust failed: ${msg}`);
      }
    } finally {
      setCertLoading(false);
    }
  };

  const handleModelChange = async (name: string, val: string) => {
    const updated = { ...modelMappings, [name]: val };
    setModelMappings(updated);
    try {
      const api = (window as unknown as Record<string, unknown>).bridgeApi as Record<string, (...args: unknown[]) => Promise<unknown>>;
      if (api?.updateMitmModelMappings) {
        await api.updateMitmModelMappings(updated);
      }
    } catch (err) {
      console.error("Failed to save model mapping:", err);
    }
  };

  return (
    <div style={{ padding: "8px 0", display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* MITM Server Card */}
      <div
        style={{
          background: "rgba(244, 180, 0, 0.03)",
          border: "1px solid rgba(244, 180, 0, 0.2)",
          borderRadius: "14px",
          padding: "20px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: "800",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                padding: "2px 8px",
                borderRadius: "6px",
                background: "rgba(244, 180, 0, 0.15)",
                color: "#f4b400",
              }}
            >
              security
            </span>
            <span style={{ fontSize: "16px", fontWeight: "800", color: "var(--text)" }}>
              MITM Server
            </span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: "700",
                padding: "2px 10px",
                borderRadius: "12px",
                background: isRunning ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                color: isRunning ? "#22c55e" : "#ef4444",
                border: `1px solid ${isRunning ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
              }}
            >
              {isRunning ? "Running" : "Stopped"}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              fontSize: "12px",
              color: "var(--muted)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Icon
                icon={isCertGenerated ? "solar:check-circle-bold-duotone" : "solar:close-circle-bold-duotone"}
                style={{ color: isCertGenerated ? "#22c55e" : "#ef4444", fontSize: "16px" }}
              />
              <span>Cert</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Icon
                icon={isCertTrusted ? "solar:check-circle-bold-duotone" : "solar:close-circle-bold-duotone"}
                style={{ color: isCertTrusted ? "#22c55e" : "#ef4444", fontSize: "16px" }}
              />
              <span>Trusted</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Icon
                icon={isRunning ? "solar:check-circle-bold-duotone" : "solar:close-circle-bold-duotone"}
                style={{ color: isRunning ? "#22c55e" : "#ef4444", fontSize: "16px" }}
              />
              <span>Server</span>
            </div>
          </div>
        </div>

        {/* Purpose / How it works Box */}
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "10px",
            background: "rgba(0, 0, 0, 0.3)",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            fontSize: "13px",
            lineHeight: "1.6",
            color: "var(--muted)",
          }}
        >
          <div>
            <strong style={{ color: "var(--text)" }}>Purpose:</strong> Use Antigravity IDE &amp; GitHub Copilot → with ANY provider/model from 9Router
          </div>
          <div>
            <strong style={{ color: "var(--text)" }}>How it works:</strong> Antigravity/Copilot IDE request → DNS redirect to localhost:443 → MITM proxy intercepts → 9Router → response to Antigravity/Copilot
          </div>
        </div>

        {/* Inputs */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "140px 24px 1fr",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text)" }}>
              9Router Base URL
            </span>
            <Icon icon="solar:alt-arrow-right-bold" style={{ color: "var(--muted)", fontSize: "14px" }} />
            <input
              type="text"
              placeholder="http://localhost:20128"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                color: "var(--text)",
                fontSize: "13px",
                outline: "none",
              }}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "140px 24px 1fr",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text)" }}>
              API Key
            </span>
            <Icon icon="solar:alt-arrow-right-bold" style={{ color: "var(--muted)", fontSize: "14px" }} />
            <input
              type="text"
              list="mitm-api-keys"
              placeholder="sk_9router (default)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                color: "var(--text)",
                fontSize: "13px",
                outline: "none",
              }}
            />
            <datalist id="mitm-api-keys">
              <option value="sk-764625c2f61b54f5-23rqmw-438bb820">ew</option>
              <option value="sk-b0797d3452a0d6a7-ff82cc-04028b46">Untitled</option>
              <option value="sk-b0797d3452a0d6a7-a59003-fd20334a">Untitled</option>
            </datalist>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "4px" }}>
          <button
            onClick={handleTrustCert}
            disabled={isCertTrusted || certLoading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              background: isCertTrusted ? "rgba(244, 180, 0, 0.05)" : "rgba(244, 180, 0, 0.15)",
              border: "1px solid rgba(244, 180, 0, 0.3)",
              color: "#f4b400",
              fontSize: "13px",
              fontWeight: "600",
              cursor: isCertTrusted || certLoading ? "default" : "pointer",
              opacity: isCertTrusted || certLoading ? 0.6 : 1,
              transition: "all 0.2s ease",
            }}
          >
            <Icon icon="solar:verified-check-bold-duotone" style={{ fontSize: "16px" }} />
            {certLoading ? "Installing..." : isCertTrusted ? "Cert Trusted" : "Trust Cert"}
          </button>

          <button
            onClick={toggleServer}
            disabled={serverLoading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              background: isRunning ? "rgba(239, 68, 68, 0.15)" : "rgba(244, 180, 0, 0.2)",
              border: `1px solid ${isRunning ? "rgba(239, 68, 68, 0.3)" : "rgba(244, 180, 0, 0.4)"}`,
              color: isRunning ? "#ef4444" : "#f4b400",
              fontSize: "13px",
              fontWeight: "700",
              cursor: serverLoading ? "wait" : "pointer",
              opacity: serverLoading ? 0.6 : 1,
              transition: "all 0.2s ease",
            }}
          >
            <Icon
              icon={isRunning ? "solar:stop-circle-bold-duotone" : "solar:play-circle-bold-duotone"}
              style={{ fontSize: "16px" }}
            />
            {serverLoading ? "Starting..." : isRunning ? "Stop Server" : "Start Server"}
          </button>
        </div>
      </div>

      {/* Antigravity Provider Card */}
      <div
        style={{
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid var(--line)",
          borderRadius: "14px",
          padding: "20px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.2)",
        }}
      >
        {/* Card Header (Collapsible) */}
        <div
          onClick={() => setIsAgExpanded((prev) => !prev)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "rgba(244, 180, 0, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <img src={logo} alt="Antigravity Logo" style={{ width: "22px", height: "22px", objectFit: "contain" }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text)" }}>Antigravity</h3>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "700",
                    padding: "2px 8px",
                    borderRadius: "10px",
                    background: isDnsStarted ? "rgba(34, 197, 94, 0.15)" : "rgba(255, 255, 255, 0.06)",
                    color: isDnsStarted ? "#22c55e" : "var(--muted)",
                  }}
                >
                  {isDnsStarted ? "Server active" : "Server off"}
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0 }}>
                Intercept Antigravity requests via MITM proxy
              </p>
            </div>
          </div>

          <Icon
            icon="solar:alt-arrow-down-bold"
            style={{
              fontSize: "20px",
              color: "var(--muted)",
              transform: isAgExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
            }}
          />
        </div>

        {/* Collapsible Content */}
        {isAgExpanded && (
          <div
            style={{
              marginTop: "16px",
              paddingTop: "16px",
              borderTop: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {/* Hosts file manual instructions */}
            <div
              style={{
                borderRadius: "8px",
                border: "1px solid var(--line)",
                background: "rgba(0, 0, 0, 0.3)",
                padding: "10px 14px",
              }}
            >
              <p style={{ fontSize: "11px", fontWeight: "600", color: "var(--text)", marginBottom: "6px" }}>
                Edit hosts file manually to add the following entries:
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, fontFamily: "monospace", fontSize: "11px", color: "#e4e4e7", display: "flex", flexDirection: "column", gap: "3px" }}>
                <li>127.0.0.1 daily-cloudcode-pa.googleapis.com</li>
                <li>127.0.0.1 cloudcode-pa.googleapis.com</li>
              </ul>
            </div>

            {/* DNS Note */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--muted)" }}>
              <p style={{ margin: 0 }}>Toggle DNS to redirect Antigravity traffic through 9Router via MITM.</p>
              {!isDnsStarted && (
                <p style={{ margin: "2px 0 0 0", color: "#d97706", fontSize: "11px", fontWeight: "600" }}>
                  ⚠️ Enable DNS to edit model mappings
                </p>
              )}
            </div>

            {/* Model Mappings List */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {AG_MODELS.map((modelName) => (
                <div
                  key={modelName}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(180px, 1fr) 20px 2fr 80px",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text)", textAlign: "right" }}>
                    {modelName}
                  </span>
                  <Icon icon="solar:alt-arrow-right-bold" style={{ color: "var(--muted)", fontSize: "14px" }} />
                  <input
                    type="text"
                    placeholder="provider/model-id"
                    disabled={!isDnsStarted}
                    value={modelMappings[modelName] || ""}
                    onChange={(e) => handleModelChange(modelName, e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      background: "rgba(0, 0, 0, 0.4)",
                      border: "1px solid var(--line)",
                      borderRadius: "6px",
                      color: "var(--text)",
                      fontSize: "12px",
                      outline: "none",
                      opacity: isDnsStarted ? 1 : 0.5,
                      cursor: isDnsStarted ? "text" : "not-allowed",
                    }}
                  />
                  <button
                    disabled={!isDnsStarted}
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: "600",
                      borderRadius: "6px",
                      border: "1px solid var(--line)",
                      background: "rgba(255, 255, 255, 0.05)",
                      color: "var(--text)",
                      cursor: isDnsStarted ? "pointer" : "not-allowed",
                      opacity: isDnsStarted ? 1 : 0.5,
                    }}
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>

            {/* Start/Stop DNS Button */}
            <div style={{ display: "flex", marginTop: "4px" }}>
              <button
                onClick={() => setIsDnsStarted((prev) => !prev)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  background: isDnsStarted ? "rgba(239, 68, 68, 0.15)" : "rgba(244, 180, 0, 0.2)",
                  border: `1px solid ${isDnsStarted ? "rgba(239, 68, 68, 0.3)" : "rgba(244, 180, 0, 0.4)"}`,
                  color: isDnsStarted ? "#ef4444" : "#f4b400",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <Icon
                  icon={isDnsStarted ? "solar:stop-circle-bold-duotone" : "solar:play-circle-bold-duotone"}
                  style={{ fontSize: "16px" }}
                />
                {isDnsStarted ? "Stop DNS" : "Start DNS"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
