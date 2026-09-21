import { memo, useState } from "react";
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
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info"; visible: boolean }>({
    message: "",
    type: "success",
    visible: false,
  });

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 2600);
  };

  const activeAccount = state.config.accounts.find((account) => account.id === state.config.activeAccountId) ?? state.config.accounts[0];
  const maxKeys = 10;
  const activeKeysCount = state.clientKeys.length;

  return (
    <div className="linear-apikeys-page">
      {/* 1. MINIMALIST PAGE HEADER */}
      <div className="page-header-row">
        <div className="header-titles">
          <div className="title-with-pill">
            <h1 className="page-main-title">API Keys</h1>
            <span className="key-quota-pill">
              {activeKeysCount} / {maxKeys} active
            </span>
          </div>
          <p className="page-main-desc">
            Manage your local client credentials, proxy endpoints, and default AI model routing.
          </p>
        </div>

        <button
          className="premium-button primary"
          onClick={onOpenCreateKey}
          id="btn-create-key-header"
        >
          <Icon icon="solar:add-circle-bold" className="btn-icon" />
          <span>Create Key</span>
        </button>
      </div>

      {/* 2. CONNECTION CREDENTIALS SECTION */}
      <section className="linear-card">
        <div className="card-header-simple">
          <div>
            <h3 className="card-title">Connection Endpoints</h3>
            <p className="card-desc">Use these credentials in any OpenAI SDK or compatible client</p>
          </div>
          <span className="protocol-pill">OpenAI Compatible</span>
        </div>

        <div className="endpoint-rows-container">
          {/* Base URL Row */}
          <div className="endpoint-row">
            <div className="endpoint-info">
              <span className="endpoint-label">Base URL</span>
              <code className="endpoint-val" title={clientBaseUrl}>{clientBaseUrl}</code>
            </div>
            <button
              className="premium-button ghost sm"
              onClick={() => {
                navigator.clipboard.writeText(clientBaseUrl);
                showToast("Base URL copied to clipboard", "info");
              }}
              title="Copy Base URL"
            >
              <Icon icon="solar:copy-bold" className="btn-icon" />
              <span>Copy</span>
            </button>
          </div>

          {/* Client Key Row */}
          <div className="endpoint-row">
            <div className="endpoint-info">
              <span className="endpoint-label">API Key</span>
              <code className="endpoint-val" title={localClientKey}>{localClientKey}</code>
            </div>
            <button
              className="premium-button ghost sm"
              onClick={() => {
                navigator.clipboard.writeText(localClientKey);
                showToast("API Key copied to clipboard", "info");
              }}
              title="Copy API Key"
            >
              <Icon icon="solar:copy-bold" className="btn-icon" />
              <span>Copy</span>
            </button>
          </div>

          {/* Selected Model Row */}
          <div className="endpoint-row">
            <div className="endpoint-info">
              <span className="endpoint-label">Model</span>
              <code className="endpoint-val" title={form.selectedModel || "Not selected"}>
                {form.selectedModel || "Not selected"}
              </code>
            </div>
            <button
              className="premium-button ghost sm"
              onClick={() => {
                const model = form.selectedModel || "Not selected";
                navigator.clipboard.writeText(model);
                showToast(`Model name "${model}" copied`, "info");
              }}
              title="Copy Model Name"
            >
              <Icon icon="solar:copy-bold" className="btn-icon" />
              <span>Copy</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. MODEL CONFIGURATION */}
      <section className="linear-card">
        <div className="card-header-simple">
          <div className="header-with-badge">
            <div>
              <h3 className="card-title">Model Routing & Catalog</h3>
              <p className="card-desc">Search and select the default model routed by the gateway</p>
            </div>
            <span className={`status-pill ${activeAccount ? "success" : "warning"}`}>
              {activeAccount ? "Connected" : "No Account"}
            </span>
          </div>

          <button
            className="premium-button ghost sm"
            onClick={onRefreshActiveAccountModels}
            disabled={saving || !activeAccount}
            id="btn-scan-models"
          >
            <Icon icon="solar:refresh-bold" className={`btn-icon ${saving ? "animate-spin" : ""}`} />
            <span>{saving ? "Scanning..." : "Scan Models"}</span>
          </button>
        </div>

        {/* Model Picker */}
        <div className="model-picker-container-full">
          <ModelPicker
            label="Default Route Model"
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
            footerRight={
              <span className="models-count-tag">
                <Icon icon="solar:box-bold-duotone" /> {state.config.models.length} Models
              </span>
            }
          />
        </div>
      </section>

      {/* 4. CLIENT ACCESS KEYS TABLE */}
      <section className="linear-card">
        <div className="card-header-simple">
          <div>
            <h3 className="card-title">Client API Keys</h3>
            <p className="card-desc">Keys authorized to make requests through this gateway</p>
          </div>
        </div>

        <div className="table-responsive">
          <table className="premium-data-table">
            <thead>
              <tr>
                <th>Key Name</th>
                <th>Masked Key</th>
                <th>Created</th>
                <th>Last Used</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.clientKeys.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state-minimal">
                      <p>No client API keys created yet.</p>
                      <button className="premium-button ghost sm" onClick={onOpenCreateKey}>
                        <Icon icon="solar:add-circle-bold" className="btn-icon" />
                        Create your first key
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                state.clientKeys.map((clientKey) => (
                  <tr key={clientKey.id}>
                    <td>
                      <div className="table-name-cell">
                        <strong className="name-bold">{clientKey.name}</strong>
                        <span className="status-pill info">Bridge</span>
                      </div>
                    </td>
                    <td>
                      <code className="table-key-code">{clientKey.maskedKey}</code>
                    </td>
                    <td>
                      <span className="table-muted-text">{new Date(clientKey.createdAt).toLocaleDateString()}</span>
                    </td>
                    <td>
                      <span className="table-muted-text">{clientKey.lastUsedAt ? new Date(clientKey.lastUsedAt).toLocaleString() : "Never"}</span>
                    </td>
                    <td>
                      <div className="table-action-buttons">
                        <button
                          className="premium-button ghost sm"
                          onClick={() => {
                            navigator.clipboard.writeText(clientKey.key);
                            showToast(`Copied key for ${clientKey.name}`, "info");
                          }}
                          title="Copy Full Key"
                        >
                          <Icon icon="solar:copy-bold" className="btn-icon" />
                          <span>Copy</span>
                        </button>
                        <button
                          className="premium-button ghost sm"
                          onClick={() => openEditKeyModal(clientKey.id, clientKey.name)}
                          title="Edit Key Name"
                        >
                          <Icon icon="solar:pen-bold" className="btn-icon" />
                          <span>Edit</span>
                        </button>
                        <button
                          className="premium-button danger sm"
                          onClick={() => {
                            onDeleteKey(clientKey.id);
                            showToast(`Deleted key ${clientKey.name}`, "error");
                          }}
                          disabled={saving}
                          title="Delete Key"
                        >
                          <Icon icon="solar:trash-bin-trash-bold" className="btn-icon" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. MINIMALIST SCOPED CSS */}
      <style>{`
        .linear-apikeys-page {
          display: flex;
          flex-direction: column;
          gap: 24px;
          color: #ffffff;
          width: 100%;
          animation: linearFadeIn 0.25s ease forwards;
        }

        @keyframes linearFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes linearToastUp {
          from { transform: translate(-50%, 80%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }

        /* 1. Header */
        .page-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
          padding-bottom: 4px;
        }

        .header-titles {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .title-with-pill {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .page-main-title {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #ffffff;
          margin: 0;
        }

        .key-quota-pill {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 3px 9px;
          border-radius: 20px;
          background: rgba(244, 180, 0, 0.1);
          color: #f4b400;
          border: 1px solid rgba(244, 180, 0, 0.25);
        }

        .page-main-desc {
          font-size: 13px;
          color: #a1a1aa;
          margin: 0;
        }

        /* 2. Full-Width Cards */
        .linear-card {
          background: #0c0c0e;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 16px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          transition: border-color 0.2s ease;
        }

        .linear-card:hover {
          border-color: rgba(255, 255, 255, 0.1);
        }

        .card-header-simple {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }

        .header-with-badge {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .card-title {
          font-size: 15px;
          font-weight: 700;
          color: #ffffff;
          margin: 0;
          letter-spacing: -0.01em;
        }

        .card-desc {
          font-size: 12px;
          color: #a1a1aa;
          margin: 2px 0 0 0;
        }

        .protocol-pill {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 3px 9px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
          color: #a1a1aa;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        /* 3. Endpoint Rows */
        .endpoint-rows-container {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .endpoint-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 12px;
          padding: 12px 16px;
          gap: 14px;
          min-width: 0;
          transition: border-color 0.2s ease, background 0.2s ease;
        }

        .endpoint-row:hover {
          background: rgba(255, 255, 255, 0.03);
          border-color: rgba(244, 180, 0, 0.25);
        }

        .endpoint-info {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          flex: 1;
        }

        .endpoint-label {
          font-size: 11px;
          font-weight: 700;
          color: #71717a;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          flex-shrink: 0;
        }

        .endpoint-val {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          font-weight: 700;
          color: #ffffff;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* 4. Model Section */
        .model-picker-container-full {
          width: 100%;
        }

        .models-count-tag {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 700;
          color: #f4b400;
          background: rgba(244, 180, 0, 0.08);
          border: 1px solid rgba(244, 180, 0, 0.2);
          padding: 2px 8px;
          border-radius: 10px;
        }

        /* 5. Table */
        .table-name-cell {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .name-bold {
          color: #ffffff;
          font-size: 14px;
        }

        .table-key-code {
          font-family: 'JetBrains Mono', monospace;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.05);
          padding: 3px 7px;
          border-radius: 6px;
          font-size: 12px;
          color: #e4e4e7;
        }

        .table-muted-text {
          font-size: 12px;
          color: #a1a1aa;
        }

        .table-action-buttons {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
        }

        .empty-state-minimal {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 36px 16px;
          text-align: center;
          gap: 12px;
        }

        .empty-state-minimal p {
          margin: 0;
          font-size: 13px;
          color: #71717a;
        }

        /* 6. Toast */
        .linear-toast {
          position: fixed;
          bottom: 32px;
          left: 50%;
          transform: translateX(-50%);
          background: #141418;
          color: #ffffff;
          padding: 10px 20px;
          border-radius: 100px;
          display: flex;
          align-items: center;
          gap: 8px;
          z-index: 99999;
          font-weight: 700;
          font-size: 13px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7);
          white-space: nowrap;
          animation: linearToastUp 0.25s ease forwards;
        }

        .toast-ico {
          font-size: 16px;
        }

        .linear-toast.success .toast-ico { color: #10b981; }
        .linear-toast.error .toast-ico { color: #f43f5e; }
        .linear-toast.info .toast-ico { color: #f4b400; }

        @media (max-width: 960px) {
          .endpoint-rows-container {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .endpoint-info {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
          }
          .endpoint-label {
            min-width: unset;
          }
        }
      `}</style>

      {/* Toast Notification */}
      {toast.visible && (
        <div className={`linear-toast ${toast.type}`}>
          <Icon
            icon={
              toast.type === "success"
                ? "solar:check-circle-bold"
                : toast.type === "error"
                ? "solar:danger-bold"
                : "solar:info-circle-bold"
            }
            className="toast-ico"
          />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export const ApiKeysPage = memo(ApiKeysPageComponent, (prev, next) => {
  return (
    prev.state === next.state &&
    prev.form === next.form &&
    prev.apiKeyModelQuery === next.apiKeyModelQuery &&
    prev.clientBaseUrl === next.clientBaseUrl &&
    prev.localClientKey === next.localClientKey &&
    prev.saving === next.saving
  );
});

export default ApiKeysPage;
