import { memo, useMemo, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Icon } from "@iconify/react";
import type { BridgeConfig, BridgeState } from "../../../shared/types";
import { copyModelPayload, maskKey } from "../appState";
import { ModelPicker } from "../components/ModelPicker";

const INITIAL_MODEL_CATALOG_LIMIT = 24;

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
}) {
  const [isCatalogExpanded, setIsCatalogExpanded] = useState(false);
  const activeAccount = state.config.accounts.find((account) => account.id === state.config.activeAccountId) ?? state.config.accounts[0];
  const catalogModels = useMemo(() => {
    if (isCatalogExpanded || state.config.models.length <= INITIAL_MODEL_CATALOG_LIMIT) {
      return state.config.models;
    }

    return state.config.models.slice(0, INITIAL_MODEL_CATALOG_LIMIT);
  }, [isCatalogExpanded, state.config.models]);

  return (
    <>
      <section className="api-keys-summary admin-panel">
        <div className="section-heading">
          <div className="summary-title-row">
            <span className="metric-chip orange">⌁</span>
            <h3>1 active / 10 max API keys</h3>
          </div>
          <button className="primary-button" onClick={onOpenCreateKey}>Create Key</button>
        </div>
      </section>

      <section className="api-keys-grid">
        <article className="admin-panel key-record-card">
          <div className="key-record-head">
            <div>
              <h3>Active upstream account</h3>
              <div className="status-pill">Active</div>
            </div>
            <button className="ghost-button" onClick={onRefreshActiveAccountModels} disabled={saving || !activeAccount}>Sync models</button>
          </div>
          <p className="key-line">API Key: {maskKey(state.config.apiKey)}</p>
          <p className="muted-copy">Created: {new Date().toLocaleDateString()} • Last used: {state.stats.lastRequestAt ? new Date(state.stats.lastRequestAt).toLocaleString() : "Not used yet"}</p>
          <div className="key-meta-grid">
            <div>
              <span>Base URL</span>
              <strong>{activeAccount?.baseUrl || form.upstreamBaseUrl || "Not configured"}</strong>
            </div>
            <div>
              <span>Selected model</span>
              <strong>{form.selectedModel || "Not selected"}</strong>
            </div>
          </div>
        </article>

        {state.clientKeys.length === 0 ? <article className="admin-panel key-record-card empty-key-card">
          <h3>No client keys yet</h3>
          <p className="muted-copy">Create Key button se local client key generate kijiye. Yeh key aap external apps me use karenge.</p>
        </article> : null}

        {state.clientKeys.map((clientKey) => (
          <article className="admin-panel key-record-card" key={clientKey.id}>
            <div className="key-record-head">
              <div>
                <h3>{clientKey.name}</h3>
                <div className="status-pill blue-pill">Bridge</div>
              </div>
              <div className="key-actions">
                <button className="ghost-button" onClick={() => navigator.clipboard.writeText(clientKey.key)}>Copy key</button>
                <button className="ghost-button" onClick={() => openEditKeyModal(clientKey.id, clientKey.name)}>Edit</button>
                <button className="ghost-button danger-button" onClick={() => onDeleteKey(clientKey.id)} disabled={saving}>Delete</button>
              </div>
            </div>
            <p className="key-line">Client API Key: {clientKey.maskedKey}</p>
            <p className="muted-copy">Created: {new Date(clientKey.createdAt).toLocaleString()} • Last used: {clientKey.lastUsedAt ? new Date(clientKey.lastUsedAt).toLocaleString() : "Not used yet"}</p>
            <div className="key-meta-grid">
              <div>
                <span>Client base URL</span>
                <strong>{clientBaseUrl}</strong>
              </div>
              <div>
                <span>Health endpoint</span>
                <strong>{state.stats.localBaseUrl}/health</strong>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="api-keys-grid lower-grid">
        <article className="admin-panel settings-panel">
          <div className="section-heading">
            <h3>Model configuration</h3>
            <div className="actions-row">
              <span className="panel-tag muted-tag">Active account driven</span>
              <button className="ghost-button" onClick={onRefreshActiveAccountModels} disabled={saving || !activeAccount}>Refresh models</button>
            </div>
          </div>
          <div className="form-grid dark-form-grid">
            <ModelPicker
              label="Selected model"
              value={form.selectedModel}
              models={state.config.models}
              query={apiKeyModelQuery}
              onQueryChange={setApiKeyModelQuery}
              onSelect={(model) => {
                setForm({ ...form, selectedModel: model });
                setApiKeyModelQuery(model);
              }}
            />
            <div className="full-width detail-list">
              <div><span>Source account</span><strong>{activeAccount?.name || "No active account"}</strong></div>
              <div><span>Base URL</span><strong>{activeAccount?.baseUrl || "Not configured"}</strong></div>
              <div><span>Available models</span><strong>{state.config.models.length}</strong></div>
            </div>
          </div>
        </article>

        <article className="stack-column">
          <article className="admin-panel compact-panel heroui-info-card">
            <div className="section-heading heroui-section-heading">
              <h3>Client usage</h3>
              <Button variant="ghost" onPress={() => navigator.clipboard.writeText(clientBaseUrl)}>
                <Icon icon="solar:copy-bold-duotone" className="heroui-action-icon" />
                Copy endpoint
              </Button>
            </div>
            <div className="detail-list">
              <div><span>Base URL</span><strong>{clientBaseUrl}</strong></div>
              <div><span>API key</span><strong>{localClientKey}</strong></div>
              <div><span>Selected model</span><strong>{form.selectedModel || "No model selected"}</strong></div>
            </div>
          </article>

          <article className="admin-panel compact-panel heroui-info-card">
            <div className="section-heading heroui-section-heading">
              <h3>Model catalog</h3>
              <Button variant="ghost" onPress={() => navigator.clipboard.writeText(clientBaseUrl)}>
                <Icon icon="solar:copy-bold-duotone" className="heroui-action-icon" />
                Copy base URL
              </Button>
            </div>
            <div className="model-catalog heroui-model-catalog">
              {catalogModels.map((model) => (
                <div className="model-row heroui-model-row" key={model}>
                  <div>
                    <strong>{model}</strong>
                    <p>{clientBaseUrl}</p>
                  </div>
                  <div className="key-actions heroui-inline-actions">
                    <Button variant="ghost" onPress={() => navigator.clipboard.writeText(model)}>Copy model</Button>
                    <Button variant="ghost" onPress={() => copyModelPayload(state.stats.localBaseUrl, model)}>Copy config</Button>
                    <Button variant="primary" onPress={() => setForm({ ...form, selectedModel: model })}>Use</Button>
                  </div>
                </div>
              ))}
            </div>
            {state.config.models.length > INITIAL_MODEL_CATALOG_LIMIT ? (
              <div className="actions-row">
                <span className="panel-tag muted-tag">
                  Showing {catalogModels.length} of {state.config.models.length} models
                </span>
                <Button variant="ghost" onPress={() => setIsCatalogExpanded((current) => !current)}>
                  {isCatalogExpanded ? "Show less" : "Show all"}
                </Button>
              </div>
            ) : null}
          </article>

          <article className="admin-panel compact-panel heroui-info-card">
            <div className="section-heading heroui-section-heading">
              <h3>Security best practices</h3>
              <Chip variant="soft" color="warning">Recommended</Chip>
            </div>
            <div className="api-keys-divider" />
            <ul className="security-list">
              <li>API keys sirf app me save rakhiye, public repo me nahi.</li>
              <li>External clients me real upstream key ke bajay local bridge key use kijiye.</li>
              <li>Unused keys ko revoke kijiye aur alag environments ke liye alag keys rakhiye.</li>
              <li>Open WebUI ya dusre tools ke liye localhost URL hi expose kijiye.</li>
            </ul>
          </article>
        </article>
      </section>
    </>
  );
}

export const ApiKeysPage = memo(ApiKeysPageComponent, (prev, next) => {
  return prev.state === next.state
    && prev.form === next.form
    && prev.apiKeyModelQuery === next.apiKeyModelQuery
    && prev.clientBaseUrl === next.clientBaseUrl
    && prev.localClientKey === next.localClientKey
    && prev.saving === next.saving;
});
