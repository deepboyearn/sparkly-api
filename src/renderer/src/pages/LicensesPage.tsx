import { memo } from "react";
import { Button, TextArea } from "@heroui/react";
import type { BridgeState } from "../../../shared/types";
import { getLicenseTone } from "../appState";

function LicensesPageComponent({
  state,
  licenseKeyInput,
  setLicenseKeyInput,
  onRefreshRequestCode,
  onClearLicense,
  saving,
}: {
  state: BridgeState;
  licenseKeyInput: string;
  setLicenseKeyInput: (value: string) => void;
  onRefreshRequestCode: () => void;
  onClearLicense: () => void;
  saving: boolean;
}) {
  return (
    <section className="content-grid overview-main-grid">
      <article className="admin-panel settings-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">License Status</p>
            <h2>Installed License</h2>
          </div>
          <span className={`status-badge ${getLicenseTone(state.license.status)}`}>{state.license.status}</span>
        </div>
        <div className="license-grid">
          <div className="license-stat-card">
            <span>Request Code</span>
            <strong>{state.license.requestCode || "Generating..."}</strong>
            <small>Send this code to the seller to receive your activation code.</small>
          </div>
          <div className="license-stat-card">
            <span>Customer</span>
            <strong>{state.license.customerName ?? "Not installed"}</strong>
            <small>{state.license.customerEmail ?? state.license.message}</small>
          </div>
          <div className="license-stat-card">
            <span>Plan</span>
            <strong>{state.license.plan ?? "-"}</strong>
            <small>Seats: {state.license.seats || 0}</small>
          </div>
          <div className="license-stat-card">
            <span>Expiry</span>
            <strong>{state.license.expiresAt ? new Date(state.license.expiresAt).toLocaleDateString() : "-"}</strong>
            <small>Offline grace: {state.license.offlineGraceDays} days</small>
          </div>
        </div>
        <div className="full-width space-y-2">
          <span className="text-sm font-medium text-white/80">Activation Code</span>
          <TextArea
            value={licenseKeyInput}
            onChange={(event) => setLicenseKeyInput(event.target.value)}
            placeholder="Paste the activation code received from the seller"
            className="license-textarea"
          />
        </div>
        <div className="actions-row">
          <Button variant="outline" onPress={() => navigator.clipboard.writeText(state.license.requestCode)} isDisabled={saving || !state.license.requestCode}>Copy request code</Button>
          <Button variant="ghost" onPress={onRefreshRequestCode} isDisabled={saving}>New request code</Button>
          <Button variant="ghost" onPress={onClearLicense} isDisabled={saving}>Clear installed license</Button>
        </div>
      </article>

      <aside className="stack-column">
        <article className="admin-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Features</p>
              <h3>Entitlements</h3>
            </div>
          </div>
          <div className="feature-list">
            {(state.license.features.length > 0 ? state.license.features : ["No entitlements installed"]).map((feature: string) => (
              <span key={feature} className="feature-pill">{feature}</span>
            ))}
          </div>
        </article>
      </aside>
    </section>
  );
}

export const LicensesPage = memo(LicensesPageComponent, (prev, next) => {
  return prev.state === next.state
    && prev.licenseKeyInput === next.licenseKeyInput
    && prev.saving === next.saving;
});
