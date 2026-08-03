import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";
import type { UpstreamAccount } from "../../../shared/types";

interface AccountPickerProps {
  accounts: UpstreamAccount[];
  selectedAccountId: string;
  onSelectAccount: (accountId: string) => void;
}

export function AccountPicker({
  accounts,
  selectedAccountId,
  onSelectAccount,
}: AccountPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || accounts[0];

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="account-picker-container">
      {/* Trigger Button */}
      <button
        type="button"
        className={`account-picker-trigger ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", overflow: "hidden" }}>
          <Icon icon="solar:user-rounded-bold-duotone" style={{ fontSize: "18px", color: "var(--primary, #f4b400)", flexShrink: 0 }} />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {selectedAccount
              ? selectedAccount.name
              : accounts.length === 0
              ? "No Gateway Accounts Configured"
              : "Select Gateway Account..."}
          </span>
          {selectedAccount?.isActive && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: "700",
                padding: "2px 8px",
                borderRadius: "10px",
                background: "rgba(34, 197, 94, 0.15)",
                color: "#22c55e",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                flexShrink: 0,
              }}
            >
              Active
            </span>
          )}
        </div>
        <Icon
          icon={isOpen ? "solar:alt-arrow-up-bold" : "solar:alt-arrow-down-bold"}
          style={{ fontSize: "14px", color: "var(--muted, #888)", transition: "transform 0.2s ease" }}
        />
      </button>

      {/* Custom Dropdown Popover */}
      {isOpen && (
        <div className="account-picker-dropdown">
          {accounts.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: "12px", color: "var(--muted, #888)", textAlign: "center" }}>
              No accounts available. Configure accounts in Bridge Connections.
            </div>
          ) : (
            accounts.map((account) => {
            const isSelected = account.id === selectedAccountId;
            return (
              <button
                key={account.id}
                type="button"
                className={`account-picker-item ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  onSelectAccount(account.id);
                  setIsOpen(false);
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <Icon
                    icon="solar:user-bold-duotone"
                    style={{ fontSize: "16px", color: isSelected ? "#f4b400" : "#888", flexShrink: 0 }}
                  />
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {account.name}
                  </span>
                  {account.isActive && (
                    <span
                      style={{
                        fontSize: "9px",
                        fontWeight: "700",
                        padding: "1px 6px",
                        borderRadius: "8px",
                        background: "rgba(34, 197, 94, 0.15)",
                        color: "#22c55e",
                        border: "1px solid rgba(34, 197, 94, 0.25)",
                        flexShrink: 0,
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>

                {isSelected && (
                  <Icon
                    icon="solar:check-circle-bold-duotone"
                    style={{ fontSize: "16px", color: "#f4b400", flexShrink: 0 }}
                  />
                )}
              </button>
            );
          })
        )}
        </div>
      )}
    </div>
  );
}
