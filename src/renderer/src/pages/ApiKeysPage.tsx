import { memo, useState } from "react";
import { Chip } from "@heroui/react";
import { Icon } from "@iconify/react";
import type { BridgeConfig, BridgeState } from "../../../shared/types";
import { maskKey } from "../appState";
import { ModelPicker } from "../components/ModelPicker";


function ApiKeysPageComponent({
  state,
  form,
  setForm,
  apiKeyModelQuery,
  setApiKeyModelQuery,
  clientBaseUrl,
  localClientKey,
  saving,
  onRefreshActiveAccountModels,
  openEditKeyModal,
  onDeleteKey,
  onOpenCreateKey,
  onSave,
}: {
  state: BridgeState;
  form: BridgeConfig;
  setForm: (value: BridgeConfig) => void;
  apiKeyModelQuery: string;
  setApiKeyModelQuery: (value: string) => void;
  clientBaseUrl: string;
  localClientKey: string;
  saving: boolean;
  onRefreshActiveAccountModels: () => void;
  openEditKeyModal: (id: string, name: string) => void;
  onDeleteKey: (id: string) => void;
  onOpenCreateKey: () => void;
  onSave: (form?: BridgeConfig) => void;
}) {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info'; visible: boolean }>({
    message: '',
    type: 'success',
    visible: false
  });

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
  };

  const activeAccount = state.config.accounts.find((account) => account.id === state.config.activeAccountId) ?? state.config.accounts[0];

  return (
    <>
      <section className="api-keys-summary admin-panel">
        <div className="section-heading">
          <div className="summary-title-row">
            <span className="metric-chip orange">
              <Icon icon="solar:key-bold-duotone" />
            </span>
            <h3>1 active / 10 max API keys</h3>
          </div>
          <button className="premium-button primary" onClick={onOpenCreateKey}>
            <Icon icon="solar:add-circle-bold" className="btn-icon" />
            Create Key
          </button>
        </div>
      </section>

      <section className="api-keys-grid">
        <article className="admin-panel key-record-card active-account-card">
          <div className="heroui-card-head">
            <div className="title-group">
              <div className="title-row">
                <Icon icon="solar:user-circle-bold-duotone" className="head-icon" />
                <h3>Active upstream account</h3>
              </div>
            </div>
            <span className="premium-badge success">
              <div className="pulse-dot success" />
              ACTIVE
            </span>
          </div>
          
          <div className="card-divider" />
          
          <div className="account-details-main">
            <div className="key-row-premium">
              <div className="key-info">
                <span className="label-text">UPSTREAM API KEY</span>
                <div className="key-display-box">
                  <Icon icon="solar:key-bold-duotone" className="field-icon" />
                  <code>{maskKey(state.config.apiKey)}</code>
                </div>
              </div>
              <div className="meta-info">
                <div className="meta-item">
                  <Icon icon="solar:calendar-minimalistic-bold-duotone" />
                  <span>Created: <strong>{new Date().toLocaleDateString()}</strong></span>
                </div>
                <div className="meta-item">
                  <Icon icon="solar:clock-circle-bold-duotone" />
                  <span>Last used: <strong>{state.stats.lastRequestAt ? new Date(state.stats.lastRequestAt).toLocaleString() : "Never"}</strong></span>
                </div>
              </div>
            </div>

            <div className="key-meta-grid-premium">
              <div className="meta-card-premium">
                <div className="meta-label">
                  <Icon icon="solar:link-bold-duotone" />
                  <span>Base URL</span>
                </div>
                <strong className="meta-value">{activeAccount?.baseUrl || form.upstreamBaseUrl || "Not configured"}</strong>
              </div>
              <div className="meta-card-premium">
                <div className="meta-label">
                  <Icon icon="solar:box-bold-duotone" />
                  <span>Selected model</span>
                </div>
                <strong className="meta-value">{form.selectedModel || "Not selected"}</strong>
              </div>
            </div>

            <div className="card-divider" style={{ margin: '20px 0' }} />
            
            <div style={{ marginBottom: '8px' }}>
              <span className="label-text">CLIENT USAGE</span>
            </div>
            
            <div className="config-meta-grid" style={{ marginTop: '16px', paddingTop: 0, borderTop: 'none' }}>
              <div className="config-meta-item">
                <div className="meta-label">
                  <Icon icon="solar:link-round-bold-duotone" />
                  <span>Client Base URL</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%' }}>
                  <strong className="meta-value" style={{ flex: 1 }}>{clientBaseUrl}</strong>
                  <button 
                    className="premium-button ghost sm" 
                    style={{ padding: '4px 8px', minWidth: 'unset', height: 'auto' }}
                    onClick={() => {
                      navigator.clipboard.writeText(clientBaseUrl);
                      showToast("Base URL copied to clipboard", "info");
                    }}
                    title="Copy Base URL"
                  >
                    <Icon icon="solar:copy-bold" />
                  </button>
                </div>
              </div>
              <div className="config-meta-item">
                <div className="meta-label">
                  <Icon icon="solar:key-bold-duotone" />
                  <span>Client API Key</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%' }}>
                  <strong className="meta-value" style={{ flex: 1 }}>{localClientKey}</strong>
                  <button 
                    className="premium-button ghost sm" 
                    style={{ padding: '4px 8px', minWidth: 'unset', height: 'auto' }}
                    onClick={() => {
                      navigator.clipboard.writeText(localClientKey);
                      showToast("API Key copied to clipboard", "info");
                    }}
                    title="Copy API Key"
                  >
                    <Icon icon="solar:copy-bold" />
                  </button>
                </div>
              </div>
              <div className="config-meta-item">
                <div className="meta-label">
                  <Icon icon="solar:box-bold-duotone" />
                  <span>Selected Model</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%' }}>
                  <strong className="meta-value" style={{ flex: 1 }}>{form.selectedModel || "Not selected"}</strong>
                  <button 
                    className="premium-button ghost sm" 
                    style={{ padding: '4px 8px', minWidth: 'unset', height: 'auto' }}
                    onClick={() => {
                      const model = form.selectedModel || "Not selected";
                      navigator.clipboard.writeText(model);
                      showToast(`Model name "${model}" copied`, "info");
                    }}
                    title="Copy Model Name"
                  >
                    <Icon icon="solar:copy-bold" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article className="admin-panel settings-panel">
          <div className="section-heading">
            <div className="title-row">
              <Icon icon="solar:settings-minimalistic-bold-duotone" style={{ fontSize: '22px', color: 'var(--primary-color)' }} />
              <h3>Model configuration</h3>
            </div>
            <div className="actions-row">
              <span className="premium-badge">ACTIVE ACCOUNT DRIVEN</span>
              <button
                className="premium-button primary sm"
                onClick={onRefreshActiveAccountModels}
                disabled={saving || !activeAccount}
              >
                <Icon icon="solar:refresh-bold" className={`btn-icon ${saving ? "animate-spin" : ""}`} />
                Scan models
              </button>
            </div>
          </div>
          <div className="form-grid dark-form-grid" style={{ marginTop: '20px' }}>
            <ModelPicker
              label="Selected model"
              value={form.selectedModel}
              models={state.config.models}
              query={apiKeyModelQuery}
              onQueryChange={setApiKeyModelQuery}
              onSelect={(model) => {
                const nextForm = { ...form, selectedModel: model };
                setForm(nextForm);
                setApiKeyModelQuery(model);
                onSave(nextForm);
              }}
              footerLeft={
                <>
                  <span className="premium-badge">
                    <Icon icon="solar:user-id-bold-duotone" /> {activeAccount?.name || "No active account"}
                  </span>
                  <span className="premium-badge">
                    <Icon icon="solar:link-round-bold-duotone" /> {activeAccount?.baseUrl || "Not configured"}
                  </span>
                  <span className="premium-badge">
                    <Icon icon="solar:box-bold-duotone" /> {state.config.models.length} Models
                  </span>
                </>
              }
            />
          </div>
        </article>
      </section>

      <section className="api-keys-table-section" style={{ marginTop: '24px' }}>
        <article className="admin-panel">
          <div className="section-heading" style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="title-row">
              <Icon icon="solar:key-minimalistic-square-bold-duotone" style={{ fontSize: '20px', color: 'var(--primary-color)' }} />
              <h3 style={{ margin: 0 }}>Client API Keys</h3>
            </div>
          </div>
          
          <div className="table-responsive">
            <table className="premium-data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Created</th>
                  <th>Last Used</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.clientKeys.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <p className="muted-copy" style={{ textAlign: 'center', padding: '30px 0', margin: 0 }}>
                        No client keys yet. Click "Create Key" to generate a local client key.
                      </p>
                    </td>
                  </tr>
                ) : (
                  state.clientKeys.map((clientKey) => (
                    <tr key={clientKey.id}>
                      <td>
                        <strong style={{ display: 'block', fontSize: '15px', color: '#fff' }}>{clientKey.name}</strong>
                        <div className="status-pill blue-pill" style={{ marginTop: '6px', padding: '2px 8px', fontSize: '10px' }}>Bridge</div>
                      </td>
                      <td><code>{clientKey.maskedKey}</code></td>
                      <td>{new Date(clientKey.createdAt).toLocaleDateString()}</td>
                      <td>{clientKey.lastUsedAt ? new Date(clientKey.lastUsedAt).toLocaleString() : "Never"}</td>
                      <td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                          <button className="premium-button ghost sm" onClick={() => {
                            navigator.clipboard.writeText(clientKey.key);
                            showToast(`Copied key for ${clientKey.name}`, "info");
                          }}>
                            <Icon icon="solar:copy-bold" className="btn-icon" />
                            Copy
                          </button>
                          <button className="premium-button ghost sm" onClick={() => openEditKeyModal(clientKey.id, clientKey.name)}>
                            <Icon icon="solar:pen-bold" className="btn-icon" />
                            Edit
                          </button>
                          <button className="premium-button danger sm" onClick={() => {
                            onDeleteKey(clientKey.id);
                            showToast(`Deleted key ${clientKey.name}`, "error");
                          }} disabled={saving}>
                            <Icon icon="solar:trash-bin-trash-bold" className="btn-icon" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <style>{`
        @keyframes slideInUp { 
          from { transform: translate(-50%, 100%); opacity: 0; } 
          to { transform: translate(-50%, 0); opacity: 1; } 
        }
        .toast-enter { animation: slideInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>

      {toast.visible && (
        <div 
          className="toast-enter"
          style={{
            position: 'fixed',
            bottom: '40px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#6366f1',
            color: '#fff',
            padding: '12px 24px',
            borderRadius: '100px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            zIndex: 9999,
            fontWeight: 700,
            fontSize: '14px',
            border: '2px solid rgba(255,255,255,0.2)',
            fontFamily: "var(--font-primary, system-ui)",
            whiteSpace: 'nowrap'
          }}
        >
          <Icon 
            icon={toast.type === 'success' ? 'solar:check-circle-bold' : toast.type === 'error' ? 'solar:danger-bold' : 'solar:info-circle-bold'} 
            width={20} 
          />
          {toast.message}
        </div>
      )}
    </>
  );
}

const ToastStyles = () => (
  <style>{`
    @keyframes slideInUp { 
      from { transform: translate(-50%, 100%); opacity: 0; } 
      to { transform: translate(-50%, 0); opacity: 1; } 
    }
    .toast-enter { animation: slideInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  `}</style>
);

export const ApiKeysPage = memo(ApiKeysPageComponent, (prev, next) => {
  return prev.state === next.state
    && prev.form === next.form
    && prev.apiKeyModelQuery === next.apiKeyModelQuery
    && prev.clientBaseUrl === next.clientBaseUrl
    && prev.localClientKey === next.localClientKey
    && prev.saving === next.saving;
});
