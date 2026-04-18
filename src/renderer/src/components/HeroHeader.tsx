import { memo } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { Icon } from "@iconify/react";

type SectionKey = "overview" | "apiKeys" | "usage" | "accounts" | "licenses" | "playground";

type HeroHeaderProps = {
  section: SectionKey;
  saving: boolean;
  playgroundLoading: boolean;
  onRestart: () => void;
  onPrimaryAction: () => void;
};

const sectionMeta: Record<SectionKey, { chip: string; title: string; buttonText: string; icon: string }> = {
  overview: {
    chip: "Overview",
    title: "Local AI Gateway Dashboard",
    buttonText: "Save changes",
    icon: "solar:diskette-bold-duotone",
  },
  apiKeys: {
    chip: "API Keys",
    title: "API Keys Management",
    buttonText: "Update keys",
    icon: "solar:key-minimalistic-square-3-bold-duotone",
  },
  usage: {
    chip: "Usage",
    title: "Usage Analytics",
    buttonText: "Refresh usage",
    icon: "solar:refresh-bold-duotone",
  },
  accounts: {
    chip: "Accounts",
    title: "Gateway Accounts",
    buttonText: "Add account",
    icon: "solar:user-plus-bold-duotone",
  },
  licenses: {
    chip: "Licenses",
    title: "License Control",
    buttonText: "Activate license",
    icon: "solar:shield-check-bold-duotone",
  },
  playground: {
    chip: "Playground",
    title: "Playground",
    buttonText: "Run test",
    icon: "solar:play-bold-duotone",
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
  const description = section === "overview"
    ? ""
    : `Manage ${meta.chip.toLowerCase()} from a focused workspace with contextual actions and live bridge state.`;

  return (
    <Card variant="tertiary" className="dashboard-hero-card shadow-2xl">
      <Card.Content className="dashboard-hero-content">
        <div className="dashboard-hero-copy">
          <Chip variant="soft" color="warning" className="dashboard-hero-chip uppercase tracking-[0.24em] text-[10px]">
            {meta.chip}
          </Chip>
          <div className="dashboard-hero-heading">
            <h1 className="dashboard-hero-title text-white">
              {meta.title}
            </h1>
            <p className="dashboard-hero-description text-sm leading-6 text-white/65">
              {description}
            </p>
          </div>
        </div>
        <div className="dashboard-hero-actions-wrap">
          <div className="dashboard-hero-actions">
            {isOverview ? <Button variant="outline" className="dashboard-hero-button dashboard-hero-button-secondary" onPress={onRestart} isDisabled={saving}>Restart</Button> : null}
            <Button
              variant="primary"
              className="dashboard-hero-button dashboard-hero-button-primary"
              onPress={onPrimaryAction}
              isDisabled={saving || playgroundLoading}
              isPending={saving || playgroundLoading}
            >
              <Icon icon={meta.icon} className="heroui-action-icon" />
              <span className="dashboard-hero-button-label">{meta.buttonText}</span>
            </Button>
          </div>
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
