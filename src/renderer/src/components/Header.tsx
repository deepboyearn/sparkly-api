import { memo } from "react";
import { Button } from "./ui";
import { Icon } from "@iconify/react";

import type { SectionKey } from "./Sidebar";

interface HeaderProps {
  section: SectionKey;
  saving: boolean;
  playgroundLoading: boolean;
  onRestart: () => void;
  onReset?: () => void;
  onPrimaryAction: () => void;
}

const sectionMeta: Record<SectionKey, { title: string; description: string; icon: string; buttonText: string }> = {
  overview: {
    title: "Gateway Dashboard",
    description: "Real-time monitoring and controls",
    buttonText: "Save changes",
    icon: "solar:diskette-bold-duotone",
  },
  apiKeys: {
    title: "Access Management",
    description: "Secure client key control",
    buttonText: "Update keys",
    icon: "solar:key-minimalistic-square-3-bold-duotone",
  },
  usage: {
    title: "Traffic Analytics",
    description: "Token and request statistics",
    buttonText: "Refresh usage",
    icon: "solar:refresh-bold-duotone",
  },
  accounts: {
    title: "Bridge Connections",
    description: "Upstream provider configuration",
    buttonText: "Add account",
    icon: "solar:user-plus-bold-duotone",
  },
  playground: {
    title: "Model Tester",
    description: "Safe local model experimentation",
    buttonText: "Run test",
    icon: "solar:play-bold-duotone",
  },
  mitm: {
    title: "MITM Proxy",
    description: "Man-in-the-Middle for Antigravity integration",
    buttonText: "",
    icon: "solar:shield-check-bold-duotone",
  },
  consoleLogs: {
    title: "Console Logs",
    description: "API calls and system events",
    buttonText: "",
    icon: "solar:bug-bold-duotone",
  },
};

function HeaderComponent({
  section,
  saving,
  playgroundLoading,
  onRestart,
  onReset,
  onPrimaryAction,
}: HeaderProps) {
  const meta = sectionMeta[section];
  const isOverview = section === "overview";
  const shouldShowPrimaryAction = section === "accounts" || section === "playground";
  const primaryActionDisabled = saving || (section === "playground" && playgroundLoading);

  return (
    <header
      style={{
        height: '90px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        background: '#0c0c0e',
        borderBottom: '1px solid #2a2a2a',
        position: 'sticky',
        top: 0,
        zIndex: 90,
        width: '100%'
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <h1 style={{
          fontSize: '20px',
          fontWeight: '500',
          color: 'var(--text)',
          margin: 0,
          letterSpacing: '-0.02em',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {meta.title}
          {saving && (
            <Icon
              icon="solar:refresh-bold-duotone"
              className="animate-spin"
              style={{ fontSize: '16px', color: 'var(--primary)' }}
            />
          )}
        </h1>
        <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, fontWeight: '600' }}>
          {meta.description}
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {section === "usage" && (
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.03)', 
            height: '44px',
            padding: '0 16px', 
            borderRadius: '12px', 
            border: '1px solid rgba(255,255,255,0.05)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '10px',
            marginRight: '8px'
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f4b400', boxShadow: '0 0 8px rgba(244, 180, 0, 0.3)' }} />
            <span style={{ fontSize: '11.5px', color: '#a1a1aa', fontWeight: 600 }}>
              Tokens reset every <b style={{ color: '#fff' }}>30 days</b>
            </span>
          </div>
        )}

        {section === "overview" && (
          <div style={{ 
            background: 'rgba(255, 255, 255, 0.03)', 
            height: '44px',
            padding: '0 16px', 
            borderRadius: '12px', 
            border: '1px solid rgba(255,255,255,0.05)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '10px',
            marginRight: '8px'
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#27c46a', boxShadow: '0 0 8px rgba(39, 196, 106, 0.3)' }} />
            <span style={{ fontSize: '11.5px', color: '#a1a1aa', fontWeight: 600 }}>
              Stats reset every <b style={{ color: '#fff' }}>5 hours</b>
            </span>
          </div>
        )}

        {onReset && (
          <Button
            variant="ghost"
            style={{
              height: '44px',
              padding: '0 18px',
              borderRadius: '12px',
              border: '1px solid rgba(244, 63, 94, 0.2)',
              color: '#fb7185',
              fontWeight: '800',
              fontSize: '12.5px',
              background: 'rgba(244, 63, 94, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}
            onPress={onReset}
            disabled={saving}
          >
            <Icon icon="solar:trash-bin-trash-bold-duotone" style={{ fontSize: '18px', flexShrink: 0 }} />
            <span style={{ position: 'relative', top: '0px' }}>Reset Data</span>
          </Button>
        )}

        {isOverview && (
          <Button
            variant="ghost"
            style={{
              height: '44px',
              padding: '0 20px',
              borderRadius: '12px',
              border: '1px solid var(--line)',
              color: 'var(--muted)',
              fontWeight: '700',
              fontSize: '13px',
              background: 'rgba(255, 255, 255, 0.03)',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
            onPress={onRestart}
            disabled={saving}
          >
            <Icon icon="solar:restart-bold-duotone" style={{ fontSize: '18px', flexShrink: 0 }} />
            <span>Restart Server</span>
          </Button>
        )}

        {shouldShowPrimaryAction && (
          <Button
            style={{
              height: '44px',
              padding: '0 18px',
              borderRadius: '12px',
              border: '1px solid rgba(244, 180, 0, 0.18)',
              color: '#0f0f10',
              fontWeight: '800',
              fontSize: '12.5px',
              background: 'linear-gradient(135deg, #f4b400 0%, #ffbf1f 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              boxShadow: '0 10px 24px rgba(244, 180, 0, 0.18)'
            }}
            onPress={onPrimaryAction}
            disabled={primaryActionDisabled}
          >
            <Icon icon={meta.icon} style={{ fontSize: '18px', flexShrink: 0 }} />
            <span>{meta.buttonText}</span>
          </Button>
        )}

      </div>
    </header>
  );
}

export const Header = memo(HeaderComponent);
