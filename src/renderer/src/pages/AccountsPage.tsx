import { memo } from "react";
import type { BridgeConfig, BridgeState, UpstreamAccount } from "../../../shared/types";
import { maskKey } from "../appState";

function AccountsPageComponent({
  state,
  form,
  clientBaseUrl,
  saving,
  onRefreshActiveAccountModels,
  openCreateAccountModal,
  openEditAccountModal,
  onSelectAccount,
  onDeleteAccount,
}: {
  state: BridgeState;
  form: BridgeConfig;
  clientBaseUrl: string;
  saving: boolean;
  onRefreshActiveAccountModels: () => void;
  openCreateAccountModal: () => void;
  openEditAccountModal: (account: UpstreamAccount) => void;
  onSelectAccount: (id: string) => void;
  onDeleteAccount: (id: string) => void;
}) {
  const accounts = state.config.accounts;

  return (
    <>
      <section className="api-keys-summary admin-panel">
        <div className="section-heading">
          <div className="summary-title-row">
            <span className="metric-chip blue">⌁</span>
            <h3>{accounts.length} gateway accounts configured</h3>
          </div>
          <div className="actions-row">
            <button className="ghost-button" onClick={onRefreshActiveAccountModels} disabled={saving || accounts.length === 0}>
              Sync active models
            </button>
            <button className="primary-button" onClick={openCreateAccountModal}>
              Add account
            </button>
          </div>
        </div>
      </section>

      <section className="accounts-layout-section">
        <article className="accounts-four-grid">
          {accounts.length === 0 ? (
            <div className="admin-panel account-card empty-key-card">
              <h3>No accounts configured</h3>
              <p className="muted-copy">
                Add account se upstream gateway account configure kijiye. Quota hit hone par bridge next account par switch karega.
              </p>
            </div>
          ) : null}

          {accounts.map((account) => (
            <div className="admin-panel account-card" key={account.id}>
              <div className="key-record-head">
                <div>
                  <h3>{account.name}</h3>
                  <div className={`status-pill ${account.id === state.config.activeAccountId ? "blue-pill" : ""}`}>
                    {account.id === state.config.activeAccountId ? "Active" : "Standby"}
                  </div>
                </div>

                <div className="key-actions">
                  <button
                    className="ghost-button"
                    onClick={() => onSelectAccount(account.id)}
                    disabled={saving || account.id === state.config.activeAccountId}
                  >
                    Set active
                  </button>

                  <button
                    className="ghost-button"
                    onClick={() => openEditAccountModal(account)}
                  >
                    Edit
                  </button>

                  <button
                    className="ghost-button danger-button"
                    onClick={() => onDeleteAccount(account.id)}
                    disabled={saving || accounts.length === 1}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="key-meta-grid">
                <div>
                  <span>Base URL</span>
                  <strong>{account.baseUrl}</strong>
                </div>

                <div>
                  <span>API key</span>
                  <strong>{maskKey(account.apiKey)}</strong>
                </div>

                <div>
                  <span>Last used</span>
                  <strong>
                    {account.lastUsedAt
                      ? new Date(account.lastUsedAt).toLocaleString()
                      : "Not used yet"}
                  </strong>
                </div>

                <div>
                  <span>Selected model</span>
                  <strong>{form.selectedModel || "No model selected"}</strong>
                </div>
              </div>
            </div>
          ))}
        </article>
      </section>
    </>
  );
}

export const AccountsPage = memo(AccountsPageComponent, (prev, next) => {
  return prev.state === next.state
    && prev.form === next.form
    && prev.clientBaseUrl === next.clientBaseUrl
    && prev.saving === next.saving;
});
