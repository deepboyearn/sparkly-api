import { memo } from "react";
import { Icon } from "@iconify/react";
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
            <span className="metric-chip blue">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
                <path fill="currentColor" d="M16.5 12c1.38 0 2.49-1.12 2.49-2.5S17.88 7 16.5 7a2.5 2.5 0 0 0 0 5M9 11c1.66 0 2.99-1.34 2.99-3S10.66 5 9 5S6 6.34 6 8s1.34 3 3 3m7.5 3c-1.83 0-5.5.92-5.5 2.75V19h11v-2.25c0-1.83-3.67-2.75-5.5-2.75M9 13c-2.33 0-7 1.17-7 3.5V19h7v-2.25c0-.85.33-2.34 2.37-3.47C10.5 13.1 9.66 13 9 13" strokeWidth="0.5" stroke="currentColor" />
              </svg>
            </span>
            <h3>{accounts.length} gateway accounts configured</h3>
          </div>
          <div className="actions-row">
            <button 
              className="premium-button primary" 
              onClick={onRefreshActiveAccountModels} 
              disabled={saving || accounts.length === 0}
            >
              <Icon icon="solar:refresh-circle-bold-duotone" className="btn-icon" />
              Sync active models
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
            <article className="account-card-new" key={account.id}>
              <div className="account-card-header">
                <div className="account-info">
                  <div className="account-icon-wrapper">
                    <Icon icon="solar:user-rounded-bold-duotone" width="24" height="24" />
                  </div>
                  <div>
                    <h3>{account.name}</h3>
                    <div className={`status-badge ${account.id === state.config.activeAccountId ? "active" : "standby"}`}>
                      <div className="dot" />
                      {account.id === state.config.activeAccountId ? "Active Gateway" : "Standby"}
                    </div>
                  </div>
                </div>

                <div className="account-quick-actions">
                  <button
                    className="action-btn"
                    onClick={() => openEditAccountModal(account)}
                    title="Edit Account"
                  >
                    <Icon icon="solar:pen-new-square-bold-duotone" />
                  </button>
                  <button
                    className="action-btn danger"
                    onClick={() => onDeleteAccount(account.id)}
                    disabled={saving}
                    title="Delete Account"
                  >
                    <Icon icon="solar:trash-bin-trash-bold-duotone" />
                  </button>
                </div>
              </div>

              <div className="account-card-body">
                <div className="meta-item">
                  <div className="meta-icon"><Icon icon="solar:server-square-cloud-bold-duotone" /></div>
                  <div className="meta-content">
                    <label>Provider</label>
                    <strong>{account.provider === "v0" ? "v0 Platform API" : "OpenAI Compatible"}</strong>
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-icon"><Icon icon="solar:link-bold-duotone" /></div>
                  <div className="meta-content">
                    <label>Base URL</label>
                    <strong>{account.baseUrl}</strong>
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-icon"><Icon icon="solar:key-bold-duotone" /></div>
                  <div className="meta-content">
                    <label>API Key</label>
                    <strong>{maskKey(account.apiKey)}</strong>
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-icon"><Icon icon="solar:clock-circle-bold-duotone" /></div>
                  <div className="meta-content">
                    <label>Last Used</label>
                    <strong>
                      {account.lastUsedAt
                        ? new Date(account.lastUsedAt).toLocaleString()
                        : "Never used"}
                    </strong>
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-icon"><Icon icon="solar:box-bold-duotone" /></div>
                  <div className="meta-content">
                    <label>Usage Filters</label>
                    <strong>Coding</strong>
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-icon"><Icon icon="solar:cpu-bolt-bold-duotone" /></div>
                  <div className="meta-content">
                    <label>Target Model</label>
                    <strong>{form.selectedModel || "Default Bridge"}</strong>
                  </div>
                </div>
              </div>

              <div className="account-card-footer">
                <button
                  className={`premium-button ${account.id === state.config.activeAccountId ? "active-btn" : "primary"}`}
                  onClick={() => onSelectAccount(account.id)}
                  disabled={saving || account.id === state.config.activeAccountId}
                >
                  <Icon 
                    icon={account.id === state.config.activeAccountId ? "solar:check-circle-bold-duotone" : "solar:bolt-bold-duotone"} 
                    className="btn-icon" 
                  />
                  {account.id === state.config.activeAccountId ? "Currently Active" : "Set as Active"}
                </button>
              </div>
            </article>
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
