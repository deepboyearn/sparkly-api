import { memo } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@iconify/react";
import { motion } from "framer-motion";

import logo from "../../../logo/logp.png";

type SectionKey = "overview" | "apiKeys" | "usage" | "accounts" | "playground";

interface SidebarProps {
  activeSection: SectionKey;
  setActiveSection: (section: SectionKey) => void;
  serverRunning: boolean;
  setError: (error: string | null) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const navItems: { key: SectionKey; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "solar:widget-5-bold-duotone" },
  { key: "apiKeys", label: "API Keys", icon: "solar:key-minimalistic-square-3-bold-duotone" },
  { key: "usage", label: "Usage", icon: "solar:chart-2-bold-duotone" },
  { key: "accounts", label: "Accounts", icon: "solar:users-group-rounded-bold-duotone" },
  { key: "playground", label: "Playground", icon: "solar:code-square-bold-duotone" },
];

function SidebarComponent({
  activeSection,
  setActiveSection,
  serverRunning,
  setError,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  return (
    <aside
      className="sidebar-custom-shell"
      style={{
        width: '100%',
        height: '100vh',
        position: 'sticky',
        top: 0,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
        overflow: 'hidden'
      }}
    >
      {/* Top Content Area */}
      <div style={{ flex: 1, padding: isCollapsed ? '32px 12px' : '32px 24px', display: 'flex', flexDirection: 'column', alignItems: isCollapsed ? 'center' : 'stretch', transition: 'padding 0.3s ease' }}>
        {/* Logo / Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '48px', padding: isCollapsed ? '0' : '0 8px', justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            background: '#f4b400',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <img src={logo} alt="Sparkly API Logo" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
          </div>
          {!isCollapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', opacity: isCollapsed ? 0 : 1, transition: 'opacity 0.2s ease', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--text)', fontWeight: '900', fontSize: '18px', letterSpacing: '-0.02em' }}>Sparkly API</span>
              <span style={{ color: 'var(--muted)', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Premium Gateway</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: isCollapsed ? 'center' : 'space-between', alignItems: 'center', marginBottom: '16px', padding: isCollapsed ? '0' : '0 8px' }}>
          {!isCollapsed && (
            <div style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.15em', whiteSpace: 'nowrap' }}>
              Navigation
            </div>
          )}
          <button 
            onClick={onToggleCollapse}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              padding: '4px',
              borderRadius: '6px',
              color: 'var(--muted)',
              transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.3s ease, color 0.2s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22 11v2c0 3.771 0 5.657-1.172 6.828c-.974.975-2.442 1.139-5.078 1.166V3.006c2.636.027 4.104.191 5.078 1.166C22 5.343 22 7.229 22 11" strokeWidth="0.5" stroke="currentColor" />
              <path fill="currentColor" fillRule="evenodd" d="M10 3h4.25v18H10c-3.771 0-5.657 0-6.828-1.172S2 16.771 2 13v-2c0-3.771 0-5.657 1.172-6.828S6.229 3 10 3m-5.25 7a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75m1 4a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75" clipRule="evenodd" strokeWidth="0.5" stroke="currentColor" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: isCollapsed ? 'center' : 'stretch' }}>
          {navItems.map((item) => {
            const isActive = activeSection === item.key;

            return (
              <motion.div
                key={item.key}
                whileHover={{ scale: 1.05, x: isCollapsed ? 0 : 5 }}
                whileTap={{ scale: 0.95 }}
                style={{ width: isCollapsed ? '48px' : '100%' }}
                title={isCollapsed ? item.label : undefined}
              >
                <Button
                  variant={isActive ? "primary" : "ghost"}
                  style={{
                    height: '48px',
                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                    padding: isCollapsed ? '0' : '0 16px',
                    width: '100%',
                    minWidth: isCollapsed ? '48px' : 'auto',
                    borderRadius: '14px',
                    background: isActive ? 'var(--primary)' : 'transparent',
                    color: isActive ? 'var(--bg)' : 'var(--muted)',
                    fontWeight: isActive ? '900' : '600',
                    border: 'none',
                    transition: 'all 0.2s ease',
                    position: 'relative'
                  }}
                  onPress={() => {
                    setError(null);
                    setActiveSection(item.key);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: isCollapsed ? 'auto' : '100%', justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
                    <Icon icon={item.icon} style={{ fontSize: '22px', opacity: isActive ? 1 : 0.7 }} />
                    {!isCollapsed && (
                      <>
                        <span style={{ fontSize: '14px', whiteSpace: 'nowrap' }}>{item.label}</span>
                      </>
                    )}
                  </div>
                </Button>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Footer Area */}
      <div style={{ padding: isCollapsed ? '10px 8px' : '10px', background: 'rgba(0, 0, 0, 0.2)' }}>
        <div style={{
          width: '100%',
          padding: isCollapsed ? '12px 0' : '16px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          flexDirection: isCollapsed ? 'column' : 'row',
          gap: isCollapsed ? '8px' : '0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <img src={logo} alt="SA" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
            </div>
            {!isCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}>
                <p style={{ margin: 0, color: '#ffffff', fontSize: '13px', fontWeight: '800' }}>Sparkly API</p>
                <p style={{ margin: 0, color: serverRunning ? '#27c46a' : 'rgba(255, 255, 255, 0.3)', fontSize: '10px', fontWeight: '600' }}>
                  {serverRunning ? "Running" : "Paused"}
                </p>
              </div>
            )}
          </div>
          {serverRunning ? (
            <div className="pulse-dot" style={{ margin: isCollapsed ? '4px 0 0 0' : '0' }} />
          ) : (
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#ff4d4f',
              margin: isCollapsed ? '4px 0 0 0' : '0'
            }} />
          )}
        </div>
      </div>
    </aside>
  );
}

export const Sidebar = memo(SidebarComponent);
