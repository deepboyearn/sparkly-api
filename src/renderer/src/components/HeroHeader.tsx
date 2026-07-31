import { memo } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { Icon } from "@iconify/react";

type SectionKey = "overview" | "apiKeys" | "usage" | "accounts" | "playground" | "uiDemo";

type HeroHeaderProps = {
  section: SectionKey;
  saving: boolean;
  playgroundLoading: boolean;
  onRestart: () => void;
  onPrimaryAction: () => void;
};

const sectionMeta: Record<SectionKey, { chip: string; title: string; description: string; icon: string; buttonText: string }> = {
  overview: {
    chip: "Overview",
    title: "Gateway Dashboard",
    description: "Real-time monitoring and controls.",
    buttonText: "Save changes",
    icon: "solar:diskette-bold-duotone",
  },
  apiKeys: {
    chip: "API Keys",
    title: "Access Management",
    description: "Secure client key control.",
    buttonText: "Update keys",
    icon: "solar:key-minimalistic-square-3-bold-duotone",
  },
  usage: {
    chip: "Usage",
    title: "Traffic Analytics",
    description: "Token and request statistics.",
    buttonText: "Refresh usage",
    icon: "solar:refresh-bold-duotone",
  },
  accounts: {
    chip: "Accounts",
    title: "Bridge Connections",
    description: "Upstream provider configuration.",
    buttonText: "Add account",
    icon: "solar:user-plus-bold-duotone",
  },
  playground: {
    chip: "Playground",
    title: "Model Tester",
    description: "Safe local model experimentation.",
    buttonText: "Run test",
    icon: "solar:play-bold-duotone",
  },
  uiDemo: {
    chip: "UI Demo",
    title: "Component Gallery",
    description: "HeroUI design system preview.",
    buttonText: "Refresh",
    icon: "solar:palet-2-bold-duotone",
  },
};

function HeroHeaderComponent({
  section,
  saving,
  playgroundLoading,
  onRestart,
  onPrimaryAction,
}: HeroHeaderProps) {
  const meta = sectionMeta[section];
  const isOverview = section === "overview";

  return (
    <Card
      style={{
        background: '#1f003d',
        border: '1px solid rgba(244, 180, 0, 0.1)',
        borderRadius: '20px',
        marginBottom: '16px',
        overflow: 'visible',
        boxShadow: 'none'
      }}
    >
      <Card.Content
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '4px 2px'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '20px' }}>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h1 style={{ fontSize: '18px', fontWeight: '900', color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>
              {meta.title}
            </h1>
            <p style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.4)', margin: 0, fontWeight: '500' }}>
              {meta.description}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
          {isOverview && (
            <Button
              variant="ghost"
              size="sm"
              style={{
                height: '36px',
                padding: '0 16px',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'rgba(255, 255, 255, 0.6)',
                fontWeight: '700',
                fontSize: '13px'
              }}
              onPress={onRestart}
              isDisabled={saving}
            >
              Restart
            </Button>
          )}

          <Button
            variant="primary"
            size="sm"
            style={{
              height: '36px',
              padding: '0 20px',
              borderRadius: '10px',
              background: '#f4b400',
              color: '#140029',
              fontWeight: '900',
              fontSize: '13px',
              boxShadow: 'none'
            }}
            onPress={onPrimaryAction}
            isDisabled={saving || playgroundLoading}
            isPending={saving || playgroundLoading}
          >
            <Icon icon={meta.icon} style={{ fontSize: '18px' }} />
            <span>{meta.buttonText}</span>
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}

export const HeroHeader = memo(HeroHeaderComponent, (prev, next) => {
  return prev.section === next.section
    && prev.saving === next.saving
    && prev.playgroundLoading === next.playgroundLoading;
});
