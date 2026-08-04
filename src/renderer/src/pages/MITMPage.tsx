import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import type { UpstreamAccount } from "../../../shared/types";
import logo from "../../../logo/logp.png";
import { AccountPicker } from "../components/AccountPicker";
import { ModelPicker } from "../components/ModelPicker";

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

type MitmApi = Record<string, (...args: unknown[]) => Promise<unknown>>;

type MITMPageProps = {
  accounts: UpstreamAccount[];
  activeAccountId: string;
  onSelectAccount: (accountId: string) => Promise<void>;
};

function getMitmApi() {
  return (window as unknown as { bridgeApi?: MitmApi }).bridgeApi;
}

function comparableMappings(mappings: Record<string, string>) {
  return AG_MODELS.map((source) => [source, mappings[source] ?? ""] as const);
}

export default function MITMPage({ accounts, activeAccountId, onSelectAccount }: MITMPageProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isCertTrusted, setIsCertTrusted] = useState(false);
  const [isCertGenerated, setIsCertGenerated] = useState(false);
  const [certLoading, setCertLoading] = useState(false);
  const [serverLoading, setServerLoading] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [showHosts, setShowHosts] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState(activeAccountId);
  const [savedMappings, setSavedMappings] = useState<Record<string, string>>({});
  const [modelMappings, setModelMappings] = useState<Record<string, string>>({});
  const [mappingQueries, setMappingQueries] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("Loading interception status...");
  const [statusKind, setStatusKind] = useState<"info" | "success" | "error">("info");

  useEffect(() => {
    if (accounts.some((account) => account.id === selectedAccountId)) return;
    setSelectedAccountId(activeAccountId || accounts[0]?.id || "");
  }, [accounts, activeAccountId, selectedAccountId]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const api = getMitmApi();
        if (!api) throw new Error("Native MITM API is unavailable");
        const [status, mappings] = await Promise.all([
          api.getMitmCertStatus() as Promise<{ exists: boolean; trusted: boolean; running: boolean }>,
          api.getMitmModelMappings() as Promise<Record<string, string>>,
        ]);
        if (cancelled) return;
        setIsCertGenerated(status.exists);
        setIsCertTrusted(status.trusted);
        setIsRunning(status.running);
        setSavedMappings(mappings);
        setModelMappings(mappings);
        setMappingQueries(mappings);
        setStatusKind("info");
        setStatusMessage(status.running ? "Interception is active on localhost:443." : "Interception is ready to configure.");
      } catch (error) {
        if (!cancelled) {
          setStatusKind("error");
          setStatusMessage(`Failed to load interception status: ${String(error)}`);
        }
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, []);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId)
      ?? accounts.find((account) => account.id === activeAccountId)
      ?? accounts[0],
    [accounts, activeAccountId, selectedAccountId],
  );
  const accountModels = useMemo(() => selectedAccount?.models ?? [], [selectedAccount]);
  const validMappings = useMemo(() => Object.fromEntries(
    comparableMappings(modelMappings).filter(([, target]) => target && accountModels.includes(target)),
  ), [accountModels, modelMappings]);
  const mappedCount = Object.keys(validMappings).length;
  const staleCount = comparableMappings(modelMappings).filter(([, target]) => target && !accountModels.includes(target)).length;
  const emptyCount = AG_MODELS.length - mappedCount - staleCount;
  const hasChanges = JSON.stringify(comparableMappings(modelMappings)) !== JSON.stringify(comparableMappings(savedMappings));
  const routeReady = Boolean(selectedAccount && accountModels.length > 0);

  const toggleServer = async () => {
    setServerLoading(true);
    setStatusKind("info");
    setStatusMessage(isRunning ? "Stopping the loopback listener..." : "Starting the loopback listener...");
    try {
      const api = getMitmApi();
      if (!api) throw new Error("Native MITM API is unavailable");
      if (isRunning) {
        await api.stopMitmServer();
        setIsRunning(false);
        setStatusKind("success");
        setStatusMessage("Interception stopped. Hosts-file changes remain under your control.");
      } else {
        await api.startMitmServer();
        setIsRunning(true);
        setStatusKind("success");
        setStatusMessage("Interception is active on localhost:443.");
      }
    } catch (error) {
      setStatusKind("error");
      setStatusMessage(`Listener error: ${String(error)}`);
    } finally {
      setServerLoading(false);
    }
  };

  const trustCertificate = async () => {
    setCertLoading(true);
    setStatusKind("info");
    setStatusMessage("Installing and trusting the local certificate...");
    try {
      const api = getMitmApi();
      if (!api) throw new Error("Native MITM API is unavailable");
      await api.trustMitmCert();
      setIsCertTrusted(true);
      setIsCertGenerated(true);
      setStatusKind("success");
      setStatusMessage("Local interception certificate is trusted.");
    } catch (error) {
      setStatusKind("error");
      setStatusMessage(`Certificate trust failed: ${String(error)}`);
    } finally {
      setCertLoading(false);
    }
  };

  const switchRoutingAccount = async (accountId: string) => {
    const account = accounts.find((candidate) => candidate.id === accountId);
    setSelectedAccountId(accountId);
    setRouteLoading(true);
    setStatusKind("info");
    setStatusMessage(account ? `Switching the active route to ${account.name}...` : "Switching routing account...");
    try {
      await onSelectAccount(accountId);
      setMappingQueries(modelMappings);
      setStatusKind("success");
      setStatusMessage(account ? `${account.name} is now the active MITM route.` : "Routing account changed.");
    } catch (error) {
      setSelectedAccountId(activeAccountId);
      setStatusKind("error");
      setStatusMessage(`Could not switch routing account: ${String(error)}`);
    } finally {
      setRouteLoading(false);
    }
  };

  const selectMapping = (sourceModel: string, targetModel: string) => {
    setModelMappings((current) => ({ ...current, [sourceModel]: targetModel }));
    setMappingQueries((current) => ({ ...current, [sourceModel]: targetModel }));
  };

  const resetMappingChanges = () => {
    setModelMappings(savedMappings);
    setMappingQueries(savedMappings);
    setStatusKind("info");
    setStatusMessage("Unsaved mapping changes were discarded.");
  };

  const saveMappings = async () => {
    if (!selectedAccount || accountModels.length === 0) {
      setStatusKind("error");
      setStatusMessage("Scan a provider account catalog before saving mappings.");
      return;
    }
    setMappingsLoading(true);
    setStatusKind("info");
    setStatusMessage("Saving validated model mappings...");
    try {
      const api = getMitmApi();
      if (!api) throw new Error("Native MITM API is unavailable");
      await api.updateMitmModelMappings(validMappings);
      setSavedMappings(validMappings);
      setModelMappings(validMappings);
      setMappingQueries(validMappings);
      setStatusKind("success");
      setStatusMessage(`Saved ${mappedCount} mappings for ${selectedAccount.name}${staleCount ? ` and removed ${staleCount} stale target${staleCount === 1 ? "" : "s"}` : ""}.`);
    } catch (error) {
      setStatusKind("error");
      setStatusMessage(`Failed to save mappings: ${String(error)}`);
    } finally {
      setMappingsLoading(false);
    }
  };

  return (
    <div className="mitm-page mitm-sparkly-page">
      <section className="api-keys-summary admin-panel mitm-page-summary">
        <div className="section-heading mitm-summary-heading">
          <div className="summary-title-row">
            <span className="metric-chip yellow"><Icon icon="solar:shield-keyhole-bold-duotone" /></span>
            <div className="mitm-heading-copy">
              <h3>Antigravity interception</h3>
              <p>Route supported traffic through Sparkly using a trusted local certificate and account-backed model mappings.</p>
            </div>
          </div>
          <span className={`premium-badge ${isRunning ? "success" : ""}`}>
            <span className={`pulse-dot ${isRunning ? "success" : "muted"}`} />
            {isRunning ? "Listener active" : "Listener stopped"}
          </span>
        </div>
      </section>

      <div className={`interaction-status-alert mitm-status-banner ${statusKind}`} role="status" aria-live="polite" aria-atomic="true">
        <Icon icon={statusKind === "error" ? "solar:danger-triangle-bold-duotone" : statusKind === "success" ? "solar:check-circle-bold-duotone" : "solar:info-circle-bold-duotone"} />
        <span>{statusMessage}</span>
      </div>

      <section className="mitm-setup-grid" aria-label="Interception setup">
        <article className="admin-panel mitm-setup-card">
          <div className="heroui-card-head">
            <div className="title-group">
              <div className="title-row">
                <Icon icon="solar:key-square-2-bold-duotone" className="head-icon" />
                <h3>Certificate</h3>
              </div>
              <p className="muted-copy">Trust Sparkly&apos;s local CA for TLS interception.</p>
            </div>
            <span className={`premium-badge ${isCertTrusted ? "success" : "warning"}`}>{isCertTrusted ? "Trusted" : isCertGenerated ? "Trust required" : "Not installed"}</span>
          </div>
          <button type="button" className={`premium-button ${isCertTrusted ? "ghost" : "primary"}`} onClick={() => void trustCertificate()} disabled={isCertTrusted || certLoading}>
            <Icon icon={certLoading ? "solar:refresh-bold-duotone" : isCertTrusted ? "solar:check-circle-bold-duotone" : "solar:verified-check-bold-duotone"} className={`btn-icon ${certLoading ? "animate-spin" : ""}`} />
            {certLoading ? "Installing certificate..." : isCertTrusted ? "Certificate trusted" : "Trust certificate"}
          </button>
        </article>

        <article className="admin-panel mitm-setup-card">
          <div className="heroui-card-head">
            <div className="title-group">
              <div className="title-row">
                <Icon icon="solar:user-id-bold-duotone" className="head-icon" />
                <h3>Routing account</h3>
              </div>
              <p className="muted-copy">Mappings use the active account&apos;s scanned catalog.</p>
            </div>
            <span className={`premium-badge ${routeReady ? "success" : "warning"}`}>{routeReady ? `${accountModels.length.toLocaleString()} models` : "Scan required"}</span>
          </div>
          <AccountPicker accounts={accounts} selectedAccountId={selectedAccount?.id ?? ""} onSelectAccount={(accountId) => void switchRoutingAccount(accountId)} />
        </article>

        <article className="admin-panel mitm-setup-card">
          <div className="heroui-card-head">
            <div className="title-group">
              <div className="title-row">
                <Icon icon="solar:server-square-cloud-bold-duotone" className="head-icon" />
                <h3>Loopback listener</h3>
              </div>
              <p className="muted-copy">127.0.0.1:443 · HTTP/1.1 over TLS</p>
            </div>
            <span className={`premium-badge ${isRunning ? "success" : ""}`}>{isRunning ? "Running" : "Stopped"}</span>
          </div>
          <button type="button" className={`premium-button ${isRunning ? "danger" : "primary"}`} onClick={() => void toggleServer()} disabled={serverLoading}>
            <Icon icon={serverLoading ? "solar:refresh-bold-duotone" : isRunning ? "solar:stop-circle-bold-duotone" : "solar:play-circle-bold-duotone"} className={`btn-icon ${serverLoading ? "animate-spin" : ""}`} />
            {serverLoading ? "Updating listener..." : isRunning ? "Stop listener" : "Start listener"}
          </button>
        </article>
      </section>

      <section className="admin-panel mitm-mappings-panel">
        <div className="heroui-card-head mitm-mappings-heading">
          <div className="title-group">
            <div className="title-row">
              <img className="mitm-app-logo" src={logo} alt="" />
              <div>
                <h3>Antigravity model mappings</h3>
                <p className="muted-copy">Choose target models from {selectedAccount?.name ?? "the active account"}. Free-text targets are disabled.</p>
              </div>
            </div>
          </div>
          <div className="mitm-count-badges" aria-label="Mapping totals">
            <span className="premium-badge success">{mappedCount} mapped</span>
            {staleCount > 0 ? <span className="premium-badge warning">{staleCount} stale</span> : null}
            <span className="premium-badge">{emptyCount} empty</span>
          </div>
        </div>

        <div className="card-divider" />

        <div className="mitm-mapping-toolbar">
          <div className="mitm-catalog-copy">
            <Icon icon={routeReady ? "solar:database-bold-duotone" : "solar:danger-triangle-bold-duotone"} />
            <div>
              <strong>{routeReady ? `${accountModels.length.toLocaleString()} provider models available` : "No selectable model catalog"}</strong>
              <span>{routeReady ? "Search the complete catalog in every mapping field." : selectedAccount ? `Scan ${selectedAccount.name} from Accounts first.` : "Create and scan a provider account first."}</span>
            </div>
          </div>
          <button type="button" className="premium-button ghost sm" onClick={() => setShowHosts((current) => !current)} aria-expanded={showHosts}>
            <Icon icon="solar:document-text-bold-duotone" className="btn-icon" />
            Hosts setup
            <Icon icon={showHosts ? "solar:alt-arrow-up-bold" : "solar:alt-arrow-down-bold"} />
          </button>
        </div>

        {showHosts ? (
          <div className="mitm-hosts-panel-sparkly">
            <div className="mitm-hosts-warning">
              <Icon icon="solar:shield-warning-bold-duotone" />
              <div><strong>Manual system change</strong><span>Administrator privileges are required. Remove these entries when interception is no longer needed.</span></div>
            </div>
            <code>127.0.0.1 daily-cloudcode-pa.googleapis.com</code>
            <code>127.0.0.1 cloudcode-pa.googleapis.com</code>
          </div>
        ) : null}

        <div className="mitm-mapping-list" aria-label="Antigravity model mappings" aria-busy={routeLoading || mappingsLoading}>
          {AG_MODELS.map((sourceModel) => {
            const targetModel = modelMappings[sourceModel] ?? "";
            const validTarget = Boolean(targetModel && accountModels.includes(targetModel));
            const staleTarget = Boolean(targetModel && !validTarget);
            return (
              <article className={`mitm-mapping-card ${staleTarget ? "invalid" : validTarget ? "mapped" : ""}`} key={sourceModel}>
                <div className="mitm-source-model-sparkly">
                  <span className="metric-chip yellow"><Icon icon="solar:cpu-bolt-bold-duotone" /></span>
                  <div><strong>{sourceModel}</strong><span>Intercepted source model</span></div>
                </div>
                <div className="mitm-target-model-sparkly">
                  <ModelPicker
                    popover
                    label="Provider target model"
                    value={validTarget ? targetModel : ""}
                    models={accountModels}
                    query={mappingQueries[sourceModel] ?? targetModel}
                    onQueryChange={(query) => setMappingQueries((current) => ({ ...current, [sourceModel]: query }))}
                    onSelect={(model) => selectMapping(sourceModel, model)}
                  />
                </div>
                <span className={`premium-badge ${staleTarget ? "warning" : validTarget ? "success" : ""}`}>
                  <Icon icon={staleTarget ? "solar:danger-triangle-bold-duotone" : validTarget ? "solar:check-circle-bold-duotone" : "solar:minus-circle-bold-duotone"} />
                  {staleTarget ? "Replace target" : validTarget ? "Mapped" : "Unmapped"}
                </span>
              </article>
            );
          })}
        </div>

        <div className="mitm-save-row">
          <div>
            <strong>{hasChanges ? "Unsaved mapping changes" : "Mappings are up to date"}</strong>
            <span>{staleCount ? `${staleCount} stale target${staleCount === 1 ? " will" : "s will"} be removed on save.` : "Only exact models from the selected account catalog can be saved."}</span>
          </div>
          <div className="actions-row">
            <button type="button" className="premium-button ghost" onClick={resetMappingChanges} disabled={!hasChanges || mappingsLoading}>Discard</button>
            <button type="button" className="premium-button primary" onClick={() => void saveMappings()} disabled={!routeReady || !hasChanges || mappingsLoading || routeLoading}>
              <Icon icon={mappingsLoading ? "solar:refresh-bold-duotone" : "solar:diskette-bold-duotone"} className={`btn-icon ${mappingsLoading ? "animate-spin" : ""}`} />
              {mappingsLoading ? "Saving mappings..." : "Save mappings"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
