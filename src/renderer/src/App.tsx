import { startTransition, useEffect, useMemo, useState } from "react";
import { Alert, Avatar, Button, ButtonGroup, Card, Chip, Input } from "@heroui/react";
import { Icon } from "@iconify/react";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip as ChartTooltip,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { BridgeConfig, BridgeState, PlaygroundModelsResult, PlaygroundTestResult } from "../../shared/types";
import { emptyState, ensureBridgeMethod, formatUptime, getHourlyPoints, getPlaygroundErrorSummary, getRequestPoints, getUsageRecords, groupKeyStats, groupModelStats, maskKey, normalizeBridgeState, normalizeOpenAiBaseUrl } from "./appState";
import { HeroHeader } from "./components/HeroHeader";
import { ModelPicker } from "./components/ModelPicker";
import { AccountsPage } from "./pages/AccountsPage";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { LicensesPage } from "./pages/LicensesPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { UsagePage } from "./pages/UsagePage";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ChartTooltip, Filler);

const lockedSections = new Set<string>(["overview", "apiKeys", "usage", "accounts", "playground"]);

export default function App() {
  const [state, setState] = useState<BridgeState>(emptyState);
  const [form, setForm] = useState<BridgeConfig>(emptyState.config);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"overview" | "apiKeys" | "usage" | "accounts" | "licenses" | "playground">("overview");
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const [isEditKeyOpen, setIsEditKeyOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editingKeyName, setEditingKeyName] = useState("");
  const [createdKeyValue, setCreatedKeyValue] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountBaseUrl, setAccountBaseUrl] = useState("https://api.souimagery.fun");
  const [accountApiKey, setAccountApiKey] = useState("");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [apiKeyModelQuery, setApiKeyModelQuery] = useState("");
  const [usageMode, setUsageMode] = useState<"statistics" | "records">("statistics");
  const [playgroundModelQuery, setPlaygroundModelQuery] = useState("");
  const [playgroundAvailableModels, setPlaygroundAvailableModels] = useState<string[]>([]);
  const [playgroundBaseUrl, setPlaygroundBaseUrl] = useState("https://api.souimagery.fun");
  const [playgroundApiKey, setPlaygroundApiKey] = useState("");
  const [playgroundModel, setPlaygroundModel] = useState("");
  const [playgroundSystemPrompt, setPlaygroundSystemPrompt] = useState("");
  const [playgroundMessage, setPlaygroundMessage] = useState("Hello");
  const [playgroundResult, setPlaygroundResult] = useState<PlaygroundTestResult | null>(null);
  const [playgroundModelsResult, setPlaygroundModelsResult] = useState<PlaygroundModelsResult | null>(null);
  const [playgroundModelsLoading, setPlaygroundModelsLoading] = useState(false);
  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const hasActiveLicense = state.license.status === "active";
  const isOverview = activeSection === "overview";
  const isApiKeys = activeSection === "apiKeys";
  const isUsage = activeSection === "usage";
  const isAccounts = activeSection === "accounts";
  const isLicenses = activeSection === "licenses";
  const isPlayground = activeSection === "playground";
  const requestPoints = useMemo(() => (
    isOverview ? getRequestPoints(state.stats.totalRequests) : []
  ), [isOverview, state.stats.totalRequests]);
  const maxPoint = useMemo(() => (
    requestPoints.length > 0 ? Math.max(...requestPoints.map((point) => point.value), 1) : 1
  ), [requestPoints]);
  const requestTrendData = useMemo(() => ({
    labels: requestPoints.map((point) => point.label),
    datasets: [
      {
        label: "Requests",
        data: requestPoints.map((point) => point.value),
        borderColor: "#f07d2f",
        backgroundColor: "rgba(240, 125, 47, 0.2)",
        fill: true,
        tension: 0.38,
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: "#f07d2f",
        pointBorderColor: "#141414",
        pointBorderWidth: 2,
      },
    ],
  }), [requestPoints]);
  const requestTrendOptions = useMemo<ChartOptions<"line">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        displayColors: false,
        backgroundColor: "rgba(20, 20, 20, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 1,
        titleColor: "#f4f4f4",
        bodyColor: "#d0d0d0",
        padding: 12,
        callbacks: {
          label: (context) => `Requests: ${context.parsed.y}`,
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: "#9c9c9c",
        },
        border: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        suggestedMax: maxPoint + 1,
        ticks: {
          stepSize: 2,
          color: "#9c9c9c",
        },
        grid: {
          color: "rgba(255, 255, 255, 0.06)",
        },
        border: {
          color: "rgba(255, 255, 255, 0.16)",
        },
      },
    },
    elements: {
      line: {
        cubicInterpolationMode: "monotone",
      },
    },
  }), [maxPoint]);
  const successRate = useMemo(() => (
    isOverview || isUsage
      ? state.stats.totalRequests === 0 ? 0 : Math.round((state.stats.successCount / state.stats.totalRequests) * 100)
      : 0
  ), [isOverview, isUsage, state.stats.successCount, state.stats.totalRequests]);
  const clientBaseUrl = `${state.stats.localBaseUrl}/v1`;
  const localClientKey = state.clientKeys[0]?.key ?? "local-bridge-client";
  const hourlyRequestPoints = useMemo(() => (
    isUsage ? getHourlyPoints(state.logs, "requests") : []
  ), [isUsage, state.logs]);
  const hourlyTokenPoints = useMemo(() => (
    isUsage ? getHourlyPoints(state.logs, "tokens") : []
  ), [isUsage, state.logs]);
  const maxHourlyRequest = useMemo(() => (
    hourlyRequestPoints.length > 0 ? Math.max(...hourlyRequestPoints.map((point) => point.value), 1) : 1
  ), [hourlyRequestPoints]);
  const maxHourlyToken = useMemo(() => (
    hourlyTokenPoints.length > 0 ? Math.max(...hourlyTokenPoints.map((point) => point.value), 1) : 1
  ), [hourlyTokenPoints]);
  const usageRequestChartData = useMemo(() => ({
    labels: hourlyRequestPoints.map((point) => point.label.replace(":00", "")),
    datasets: [
      {
        label: "Requests",
        data: hourlyRequestPoints.map((point) => point.value),
        borderColor: "#27c46a",
        backgroundColor: "rgba(39, 196, 106, 0.18)",
        fill: true,
        tension: 0.36,
        borderWidth: 3,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: "#27c46a",
        pointBorderColor: "#111",
        pointBorderWidth: 2,
      },
    ],
  }), [hourlyRequestPoints]);
  const usageTokenChartData = useMemo(() => ({
    labels: hourlyTokenPoints.map((point) => point.label.replace(":00", "")),
    datasets: [
      {
        label: "Tokens",
        data: hourlyTokenPoints.map((point) => point.value),
        borderColor: "#f07d2f",
        backgroundColor: "rgba(240, 125, 47, 0.18)",
        fill: true,
        tension: 0.36,
        borderWidth: 3,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: "#f07d2f",
        pointBorderColor: "#111",
        pointBorderWidth: 2,
      },
    ],
  }), [hourlyTokenPoints]);
  const usageRequestChartOptions = useMemo<ChartOptions<"line">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        backgroundColor: "rgba(20, 20, 20, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 1,
        titleColor: "#f4f4f4",
        bodyColor: "#d0d0d0",
        padding: 12,
        callbacks: {
          label: (context) => `Requests: ${context.parsed.y}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#9c9c9c", maxRotation: 0 },
        border: { display: false },
      },
      y: {
        beginAtZero: true,
        suggestedMax: maxHourlyRequest + 1,
        ticks: { color: "#9c9c9c", stepSize: Math.max(1, Math.ceil(maxHourlyRequest / 3)) },
        grid: { color: "rgba(255, 255, 255, 0.06)" },
        border: { color: "rgba(255, 255, 255, 0.16)" },
      },
    },
    elements: {
      line: { cubicInterpolationMode: "monotone" },
    },
  }), [maxHourlyRequest]);
  const usageTokenChartOptions = useMemo<ChartOptions<"line">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        backgroundColor: "rgba(20, 20, 20, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 1,
        titleColor: "#f4f4f4",
        bodyColor: "#d0d0d0",
        padding: 12,
        callbacks: {
          label: (context) => `Tokens: ${context.parsed.y}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#9c9c9c", maxRotation: 0 },
        border: { display: false },
      },
      y: {
        beginAtZero: true,
        suggestedMax: maxHourlyToken + Math.max(10, Math.round(maxHourlyToken * 0.1)),
        ticks: { color: "#9c9c9c" },
        grid: { color: "rgba(255, 255, 255, 0.06)" },
        border: { color: "rgba(255, 255, 255, 0.16)" },
      },
    },
    elements: {
      line: { cubicInterpolationMode: "monotone" },
    },
  }), [maxHourlyToken]);
  const modelStats = useMemo(() => (
    isUsage ? groupModelStats(state.logs) : []
  ), [isUsage, state.logs]);
  const keyStats = useMemo(() => (
    isUsage ? groupKeyStats(state.logs, state.clientKeys) : []
  ), [isUsage, state.clientKeys, state.logs]);
  const totalTokenEstimate = useMemo(() => (
    isUsage ? state.logs.reduce((total, entry) => total + Math.max(60, entry.durationMs * 3), 0) : 0
  ), [isUsage, state.logs]);
  const totalCostEstimate = useMemo(() => (
    isUsage ? state.logs.reduce((total, entry) => total + Math.max(0.001, entry.durationMs / 100000), 0) : 0
  ), [isUsage, state.logs]);
  const rpm = useMemo(() => (
    isUsage ? state.logs.filter((entry) => Date.now() - new Date(entry.timestamp).getTime() <= 60_000).length : 0
  ), [isUsage, state.logs]);
  const tpm = useMemo(() => (
    isUsage
      ? state.logs
        .filter((entry) => Date.now() - new Date(entry.timestamp).getTime() <= 60_000)
        .reduce((total, entry) => total + Math.max(60, entry.durationMs * 3), 0)
      : 0
  ), [isUsage, state.logs]);
  const usageRecords = useMemo(() => (
    isUsage ? getUsageRecords(state.logs, state.clientKeys, state.config.apiKey) : []
  ), [isUsage, state.clientKeys, state.config.apiKey, state.logs]);
  function applyLoadedBridgeState(nextState: Partial<BridgeState>) {
    const normalized = normalizeBridgeState(nextState);
    setState(normalized);
    setForm(normalized.config);
    setPlaygroundAvailableModels(normalized.config.models);
    return normalized;
  }

  async function refresh() {
    const nextState = applyLoadedBridgeState(await window.bridgeApi.getState());
    setPlaygroundBaseUrl(nextState.config.upstreamBaseUrl);
    setPlaygroundApiKey(nextState.config.apiKey);
    setPlaygroundModel(nextState.config.selectedModel);
    setLoading(false);
  }

  async function persistConfig(nextForm: BridgeConfig) {
    const savedState = applyLoadedBridgeState(await window.bridgeApi.saveConfig({
      ...nextForm,
      models: nextForm.models,
    }));
    return savedState;
  }

  function ensureLicensedAccess(sectionLabel: string) {
    if (hasActiveLicense) {
      return true;
    }

    setActiveSection("licenses");
    setError(`${sectionLabel} is locked. Activate your license to use this feature.`);
    return false;
  }

  useEffect(() => {
    refresh().catch((refreshError) => {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to load app state");
      setLoading(false);
    });

    const shouldPauseLiveRefresh = isCreateKeyOpen || isEditKeyOpen || isAccountModalOpen || saving || playgroundLoading || playgroundModelsLoading;
    if (shouldPauseLiveRefresh) {
      return;
    }

    const intervalId = window.setInterval(() => {
      window.bridgeApi
        .getState()
        .then((nextState) => {
          startTransition(() => {
            setState(normalizeBridgeState(nextState));
          });
        })
        .catch(() => undefined);
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [isAccountModalOpen, isCreateKeyOpen, isEditKeyOpen, playgroundLoading, playgroundModelsLoading, saving]);

  useEffect(() => {
    if (!hasActiveLicense && lockedSections.has(activeSection)) {
      setActiveSection("licenses");
    }
  }, [activeSection, hasActiveLicense]);

  async function onSave() {
    if (!ensureLicensedAccess("Overview")) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await persistConfig(form);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }

  async function onRestart() {
    if (!ensureLicensedAccess("Overview")) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      applyLoadedBridgeState(await window.bridgeApi.restartServer());
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : "Failed to restart local server");
    } finally {
      setSaving(false);
    }
  }

  async function onCreateKey() {
    if (!ensureLicensedAccess("API Keys")) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextState = normalizeBridgeState(await window.bridgeApi.createClientKey({ name: newKeyName }));
      setState(nextState);
      setCreatedKeyValue(nextState.clientKeys[0]?.key ?? null);
      setNewKeyName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create client key");
    } finally {
      setSaving(false);
    }
  }

  async function onUpdateKey() {
    if (!editingKeyId) {
      return;
    }

    if (!ensureLicensedAccess("API Keys")) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextState = normalizeBridgeState(await window.bridgeApi.updateClientKey({
        id: editingKeyId,
        name: editingKeyName,
      }));
      setState(nextState);
      setIsEditKeyOpen(false);
      setEditingKeyId(null);
      setEditingKeyName("");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update client key");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteKey(id: string) {
    if (!ensureLicensedAccess("API Keys")) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextState = normalizeBridgeState(await window.bridgeApi.deleteClientKey({ id }));
      setState(nextState);
      if (editingKeyId === id) {
        setIsEditKeyOpen(false);
        setEditingKeyId(null);
        setEditingKeyName("");
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete client key");
    } finally {
      setSaving(false);
    }
  }

  function openEditKeyModal(id: string, name: string) {
    if (!ensureLicensedAccess("API Keys")) {
      return;
    }

    setEditingKeyId(id);
    setEditingKeyName(name);
    setIsEditKeyOpen(true);
  }

  async function onSaveAccount() {
    if (!ensureLicensedAccess("Accounts")) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextState = editingAccountId
        ? await ensureBridgeMethod("updateAccount")({
          id: editingAccountId,
          name: accountName,
          baseUrl: accountBaseUrl,
          apiKey: accountApiKey,
          isActive: true,
        })
        : await ensureBridgeMethod("createAccount")({
          name: accountName,
          baseUrl: accountBaseUrl,
          apiKey: accountApiKey,
        });

      const normalized = applyLoadedBridgeState(nextState);
      setIsAccountModalOpen(false);
      setEditingAccountId(null);
      setAccountName("");
      setAccountBaseUrl("https://api.souimagery.fun");
      setAccountApiKey("");
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : "Failed to save account");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteAccount(id: string) {
    if (!ensureLicensedAccess("Accounts")) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      applyLoadedBridgeState(await ensureBridgeMethod("deleteAccount")({ id }));
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : "Failed to delete account");
    } finally {
      setSaving(false);
    }
  }

  async function onSelectAccount(id: string) {
    if (!ensureLicensedAccess("Accounts")) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      applyLoadedBridgeState(await ensureBridgeMethod("selectAccount")({ id }));
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : "Failed to select account");
    } finally {
      setSaving(false);
    }
  }

  function openCreateAccountModal() {
    if (!ensureLicensedAccess("Accounts")) {
      return;
    }

    setEditingAccountId(null);
    setAccountName("");
    setAccountBaseUrl("https://api.souimagery.fun");
    setAccountApiKey("");
    setIsAccountModalOpen(true);
  }

  function openEditAccountModal(account: BridgeState["config"]["accounts"][number]) {
    if (!ensureLicensedAccess("Accounts")) {
      return;
    }

    setEditingAccountId(account.id);
    setAccountName(account.name);
    setAccountBaseUrl(account.baseUrl);
    setAccountApiKey(account.apiKey);
    setIsAccountModalOpen(true);
  }

  async function onRefreshActiveAccountModels() {
    if (!ensureLicensedAccess("Accounts")) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      applyLoadedBridgeState(await ensureBridgeMethod("refreshActiveAccountModels")());
    } catch (accountError) {
      setError(accountError instanceof Error ? accountError.message : "Failed to refresh active account models");
    } finally {
      setSaving(false);
    }
  }

  async function onRunPlayground() {
    if (!ensureLicensedAccess("Playground")) {
      return;
    }

    setPlaygroundLoading(true);
    setError(null);

    try {
      const result = await ensureBridgeMethod("playgroundTest")({
        baseUrl: normalizeOpenAiBaseUrl(playgroundBaseUrl),
        apiKey: playgroundApiKey,
        model: playgroundModel,
        message: playgroundMessage,
        systemPrompt: playgroundSystemPrompt,
      });
      setPlaygroundResult(result);
    } catch (playgroundError) {
      setError(playgroundError instanceof Error ? playgroundError.message : "Playground request failed");
    } finally {
      setPlaygroundLoading(false);
    }
  }

  async function onLoadPlaygroundModels() {
    if (!ensureLicensedAccess("Playground")) {
      return;
    }

    setPlaygroundModelsLoading(true);
    setError(null);

    try {
      const result = await ensureBridgeMethod("playgroundLoadModels")({
        baseUrl: normalizeOpenAiBaseUrl(playgroundBaseUrl),
        apiKey: playgroundApiKey,
      });
      setPlaygroundModelsResult(result);

      if (result.ok) {
        setPlaygroundAvailableModels(result.models);
        if (!playgroundModel && result.models[0]) {
          setPlaygroundModel(result.models[0]);
          setPlaygroundModelQuery(result.models[0]);
        }
      }
    } catch (modelsError) {
      setError(modelsError instanceof Error ? modelsError.message : "Failed to load models");
    } finally {
      setPlaygroundModelsLoading(false);
    }
  }

  async function onActivateLicense() {
    setSaving(true);
    setError(null);

    try {
      const nextState = normalizeBridgeState(await window.bridgeApi.activateLicense({ licenseKey: licenseKeyInput }));
      setState(nextState);
      if (nextState.license.status === "active" || nextState.license.status === "expired") {
        setLicenseKeyInput("");
      }
    } catch (licenseError) {
      setError(licenseError instanceof Error ? licenseError.message : "Failed to activate license");
    } finally {
      setSaving(false);
    }
  }

  async function onClearLicense() {
    setSaving(true);
    setError(null);

    try {
      const nextState = normalizeBridgeState(await window.bridgeApi.clearLicense({ confirm: true }));
      setState(nextState);
    } catch (licenseError) {
      setError(licenseError instanceof Error ? licenseError.message : "Failed to clear license");
    } finally {
      setSaving(false);
    }
  }

  async function onRefreshRequestCode() {
    try {
      const nextState = normalizeBridgeState(
        await window.bridgeApi.generateRequestCode({})
      );
      setState(nextState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh request code");
    }
  }

  if (loading) {
    return <div className="screen centered">Loading bridge...</div>;
  }

  return (
    <div className="screen dashboard-shell heroui-dashboard-shell">
      <aside className="sidebar heroui-sidebar-shell">
        <Card className="heroui-sidebar-card">
          <Card.Content className="heroui-sidebar-content">
            <div className="heroui-sidebar-section-label">Navigation</div>
            <ButtonGroup orientation="vertical" variant="ghost" className="heroui-sidebar-nav-group">
              {[
                { key: "overview", label: "Overview", icon: "solar:widget-5-bold-duotone" },
                { key: "apiKeys", label: "API Keys", icon: "solar:key-minimalistic-square-3-bold-duotone" },
                { key: "usage", label: "Usage", icon: "solar:chart-2-bold-duotone" },
                { key: "accounts", label: "Accounts", icon: "solar:users-group-rounded-bold-duotone" },
                { key: "licenses", label: "Licenses", icon: "solar:shield-keyhole-bold-duotone" },
                { key: "playground", label: "Playground", icon: "solar:code-square-bold-duotone" },
              ].map((item) => {
                const isActive = activeSection === item.key;
                const isLocked = lockedSections.has(item.key as "overview" | "apiKeys" | "usage" | "accounts" | "playground") && !hasActiveLicense;

                return (
                  <Button
                    key={item.key}
                    variant={isActive ? "primary" : "ghost"}
                    className={`heroui-sidebar-nav-button ${isActive ? "is-active" : ""}`}
                    onPress={() => {
                      if (isLocked) {
                        setActiveSection("licenses");
                        setError(`${item.label} is locked. Activate your license to use this feature.`);
                        return;
                      }

                      setActiveSection(item.key as typeof activeSection);
                    }}
                  >
                    <span className="heroui-nav-icon-wrap">
                      <Icon icon={item.icon} className="heroui-nav-icon" />
                    </span>
                    <span className="heroui-nav-label">{item.label}</span>
                    {isLocked ? <Icon icon="solar:lock-keyhole-bold" className="heroui-nav-lock" /> : null}
                  </Button>
                );
              })}
            </ButtonGroup>
          </Card.Content>
          <Card.Footer className="heroui-sidebar-footer">
            <div className="heroui-sidebar-runtime-card">
              <div className="heroui-sidebar-runtime-main">
                <Avatar size="sm" color="accent" variant="soft" className="heroui-sidebar-runtime-avatar">
                  <Avatar.Image
                    src="/src/logo/logp.png"
                  />
                  <Avatar.Fallback>SA</Avatar.Fallback>
                </Avatar>
                <div className="heroui-sidebar-runtime-copy">
                  <p className="heroui-sidebar-runtime-title">Sparkly API</p>
                  <p className="heroui-sidebar-runtime-status">{state.stats.serverRunning ? "Running on localhost" : "Server paused"}</p>
                </div>
              </div>
              <div className="heroui-sidebar-runtime-indicator-wrap">
                <span
                  className={`heroui-sidebar-runtime-indicator ${state.stats.serverRunning ? "is-online" : "is-offline"}`}
                  aria-hidden="true"
                />
              </div>
            </div>
          </Card.Footer>
        </Card>
      </aside>

      <main className="workspace-panel dark-workspace heroui-main-shell">
        <section className="hero-header-section">
          <HeroHeader
            section={activeSection}
            saving={saving}
            playgroundLoading={playgroundLoading}
            onRestart={onRestart}
            onPrimaryAction={isUsage ? refresh : isAccounts ? openCreateAccountModal : isLicenses ? onActivateLicense : isPlayground ? onRunPlayground : onSave}
          />
        </section>

        {error ? <Alert color="danger" title={error ?? undefined} className="border border-red-500/20 bg-red-500/10 text-white" /> : null}

        {isOverview ? <section className="stats-grid admin-stats-grid overview-stats-grid">
          <Card className="metric-card border border-white/10 bg-white/5"><Card.Content><div className="metric-head"><span>Today's requests</span><Chip color="success" variant="soft">Traffic</Chip></div><strong>{state.stats.totalRequests}</strong><p>Success: {state.stats.successCount} Failed: {state.stats.errorCount}</p><div className="metric-bar"><i style={{ width: `${Math.min(100, state.stats.totalRequests * 8)}%` }} /></div></Card.Content></Card>
          <Card className="metric-card border border-white/10 bg-white/5"><Card.Content><div className="metric-head"><span>Today's tokens</span><Chip color="warning" variant="soft">Tokens</Chip></div><strong>{state.stats.totalRequests * 128}</strong><p>Cached: 0 Reasoning: {state.stats.totalRequests * 12}</p><div className="metric-bar"><i style={{ width: `${Math.min(100, state.stats.totalRequests * 6)}%` }} /></div></Card.Content></Card>
          <Card className="metric-card border border-white/10 bg-white/5"><Card.Content><div className="metric-head"><span>Active models</span><Chip color="accent" variant="soft">Models</Chip></div><strong>{state.config.models.length}</strong><p>Selected: {state.config.selectedModel || "None"}</p><div className="metric-bar"><i style={{ width: `${Math.min(100, state.config.models.length * 20)}%` }} /></div></Card.Content></Card>
          <Card className="metric-card border border-white/10 bg-white/5"><Card.Content><div className="metric-head"><span>Today's cost</span><Chip color="default" variant="soft">Spend</Chip></div><strong>$0.00</strong><p>Uptime: {formatUptime(state.stats.uptimeMs)}</p><div className="metric-bar"><i style={{ width: `${Math.min(100, successRate)}%` }} /></div></Card.Content></Card>
        </section> : null}

        {isLicenses ? <LicensesPage
          state={state}
          licenseKeyInput={licenseKeyInput}
          setLicenseKeyInput={setLicenseKeyInput}
          onRefreshRequestCode={onRefreshRequestCode}
          onClearLicense={onClearLicense}
          saving={saving}
        /> : null}

        {isOverview ? <>
          <section className="content-grid overview-main-grid">
            <article className="admin-panel chart-panel">
              <div className="section-heading">
                <h3>Request trends (Last 7 Days)</h3>
                <span className="panel-tag">Live</span>
              </div>
              <div className="overview-chart-stats">
                <div className="overview-chart-stat">
                  <span>Total requests</span>
                  <strong>{state.stats.totalRequests}</strong>
                </div>
                <div className="overview-chart-stat">
                  <span>Success rate</span>
                  <strong>{successRate}%</strong>
                </div>
                <div className="overview-chart-stat">
                  <span>Selected model</span>
                  <strong>{state.config.selectedModel || "None"}</strong>
                </div>
              </div>
              <div className="chartjs-shell">
                <Line data={requestTrendData} options={requestTrendOptions} />
              </div>
            </article>

            <article className="admin-panel activity-panel overview-activity-panel">
              <div className="section-heading">
                <h3>Recent activity</h3>
                <button className="ghost-button" onClick={() => refresh()}>Refresh</button>
              </div>
              {state.logs.length === 0 ? <div className="empty-logs dark-empty">No activity yet.</div> : null}
              <div className="activity-list">
                {state.logs.slice(0, 6).map((entry) => (
                  <div className="activity-item" key={entry.id}>
                    <div>
                      <strong>{entry.path}</strong>
                      <p>{entry.model ?? "No model"}</p>
                    </div>
                    <div className="activity-meta">
                      <span className={entry.status >= 400 ? "status-bad" : "status-good"}>{entry.status}</span>
                      <small>{new Date(entry.timestamp).toLocaleTimeString()}</small>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="content-grid lower-grid overview-lower-grid">
            <article className="admin-panel settings-panel overview-settings-panel">
              <div className="section-heading">
                <h3>Gateway settings</h3>
                <span className="panel-tag muted-tag">Saved locally</span>
              </div>
              <div className="form-grid dark-form-grid">
                <label>
                  <span>Local port</span>
                  <input
                    type="number"
                    value={form.localPort}
                    onChange={(event) => setForm({ ...form, localPort: Number(event.target.value) })}
                    placeholder="48231"
                  />
                </label>
                <div className="detail-list full-width">
                  <div><span>Active account</span><strong>{state.config.accounts.find((account) => account.id === state.config.activeAccountId)?.name ?? "No active account"}</strong></div>
                  <div><span>Base URL</span><strong>{state.config.upstreamBaseUrl || "Not configured"}</strong></div>
                  <div><span>Selected model</span><strong>{form.selectedModel || "No model selected"}</strong></div>
                </div>
                <label className="full-width">
                  <span>System prompt override</span>
                  <textarea
                    rows={4}
                    value={form.systemPrompt}
                    onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })}
                    placeholder="Optional system prompt injected if missing"
                  />
                </label>
                <label className="checkbox-row full-width dark-checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.enableCors}
                    onChange={(event) => setForm({ ...form, enableCors: event.target.checked })}
                  />
                  <span>Enable CORS for browser-based tools</span>
                </label>
              </div>
            </article>

            <article className="stack-column overview-side-stack">
              <div className="admin-panel compact-panel">
                <div className="section-heading">
                  <h3>Active key</h3>
                  <span className="panel-tag">Secure</span>
                </div>
                <div className="detail-list">
                  <div><span>Masked key</span><strong>{maskKey(state.config.apiKey)}</strong></div>
                  <div><span>Local base URL</span><strong>{state.stats.localBaseUrl}/v1</strong></div>
                  <div><span>Health endpoint</span><strong>{state.stats.localBaseUrl}/health</strong></div>
                </div>
              </div>

              <div className="admin-panel compact-panel accent-panel">
                <div className="section-heading">
                  <h3>Quick client setup</h3>
                  <button className="ghost-button" onClick={() => navigator.clipboard.writeText(`${state.stats.localBaseUrl}/v1`)}>
                    Copy URL
                  </button>
                </div>
                <div className="detail-list">
                  <div><span>Client base URL</span><strong>{state.stats.localBaseUrl}/v1</strong></div>
                  <div><span>Client API key</span><strong>{localClientKey}</strong></div>
                  <div><span>Docs</span><button className="link-button" onClick={() => window.bridgeApi.openExternal("https://docs.openwebui.com/")}>Open Open WebUI docs</button></div>
                </div>
                <pre className="curl-block">{`curl ${state.stats.localBaseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer local-test" \\
  -d '{
    "model": "${form.selectedModel || "gpt-4.1"}",
    "messages": [{"role": "user", "content": "hello"}]
  }'`}</pre>
              </div>
            </article>
          </section>
        </> : null}

        {isApiKeys ? <ApiKeysPage
          state={state}
          form={form}
          setForm={setForm}
          apiKeyModelQuery={apiKeyModelQuery}
          setApiKeyModelQuery={setApiKeyModelQuery}
          clientBaseUrl={clientBaseUrl}
          localClientKey={localClientKey}
          saving={saving}
          onRefreshActiveAccountModels={onRefreshActiveAccountModels}
          openEditKeyModal={openEditKeyModal}
          onDeleteKey={onDeleteKey}
          onOpenCreateKey={() => {
            setCreatedKeyValue(null);
            setNewKeyName("");
            setIsCreateKeyOpen(true);
          }}
        /> : null}

        {isUsage ? <UsagePage
          usageMode={usageMode}
          setUsageMode={setUsageMode}
          state={{ stats: state.stats }}
          totalTokenEstimate={totalTokenEstimate}
          rpm={rpm}
          tpm={tpm}
          totalCostEstimate={totalCostEstimate}
          usageRequestChartData={usageRequestChartData}
          usageRequestChartOptions={usageRequestChartOptions}
          usageTokenChartData={usageTokenChartData}
          usageTokenChartOptions={usageTokenChartOptions}
          modelStats={modelStats}
          keyStats={keyStats}
          usageRecords={usageRecords}
        /> : null}

        {isAccounts ? <AccountsPage
          state={state}
          form={form}
          clientBaseUrl={clientBaseUrl}
          saving={saving}
          onRefreshActiveAccountModels={onRefreshActiveAccountModels}
          openCreateAccountModal={openCreateAccountModal}
          openEditAccountModal={openEditAccountModal}
          onSelectAccount={onSelectAccount}
          onDeleteAccount={onDeleteAccount}
        /> : null}

        {isPlayground ? <PlaygroundPage
          models={playgroundAvailableModels}
          playgroundModelQuery={playgroundModelQuery}
          setPlaygroundModelQuery={setPlaygroundModelQuery}
          playgroundBaseUrl={playgroundBaseUrl}
          setPlaygroundBaseUrl={setPlaygroundBaseUrl}
          playgroundApiKey={playgroundApiKey}
          setPlaygroundApiKey={setPlaygroundApiKey}
          playgroundModel={playgroundModel}
          setPlaygroundModel={setPlaygroundModel}
          playgroundSystemPrompt={playgroundSystemPrompt}
          setPlaygroundSystemPrompt={setPlaygroundSystemPrompt}
          playgroundMessage={playgroundMessage}
          setPlaygroundMessage={setPlaygroundMessage}
          playgroundModelsResult={playgroundModelsResult}
          playgroundModelsLoading={playgroundModelsLoading}
          playgroundResult={playgroundResult}
          setPlaygroundResult={setPlaygroundResult}
          setPlaygroundModelsResult={setPlaygroundModelsResult}
          playgroundLoading={playgroundLoading}
          onLoadPlaygroundModels={onLoadPlaygroundModels}
          onRunPlayground={onRunPlayground}
        /> : null}

        {isCreateKeyOpen ? <div className="modal-overlay" onClick={() => setIsCreateKeyOpen(false)}>
          <Card className="modal-card heroui-modal-card" onClick={(event) => event.stopPropagation()}>
            <Card.Content className="heroui-modal-content">
              <div className="section-heading heroui-section-heading">
                <h3>Create client key</h3>
                <Button variant="ghost" onPress={() => setIsCreateKeyOpen(false)}>Close</Button>
              </div>
              <p className="muted-copy">Yeh local bridge key Open WebUI ya kisi bhi OpenAI-compatible client ke liye use hogi.</p>
              <label>
                <span>Key name</span>
                <Input value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} placeholder="Production key" />
              </label>
              {createdKeyValue ? <div className="created-key-box heroui-created-key-box">
                <span>New key</span>
                <strong>{createdKeyValue}</strong>
                <p className="muted-copy">Is value ko abhi copy kar lijiye. App list me masked version dikhayega.</p>
              </div> : null}
              <div className="actions-row modal-actions heroui-modal-actions">
                {createdKeyValue ? <Button variant="outline" onPress={() => navigator.clipboard.writeText(createdKeyValue)}>Copy key</Button> : null}
                <Button variant="primary" onPress={onCreateKey} isDisabled={saving} isPending={saving}>{saving ? "Creating..." : "Generate key"}</Button>
              </div>
            </Card.Content>
          </Card>
        </div> : null}

        {isEditKeyOpen ? <div className="modal-overlay" onClick={() => setIsEditKeyOpen(false)}>
          <Card className="modal-card heroui-modal-card" onClick={(event) => event.stopPropagation()}>
            <Card.Content className="heroui-modal-content">
              <div className="section-heading heroui-section-heading">
                <h3>Edit client key</h3>
                <Button variant="ghost" onPress={() => setIsEditKeyOpen(false)}>Close</Button>
              </div>
              <p className="muted-copy">Key value same rahegi, sirf name update hoga.</p>
              <label>
                <span>Key name</span>
                <Input value={editingKeyName} onChange={(event) => setEditingKeyName(event.target.value)} placeholder="Production key" />
              </label>
              <div className="actions-row modal-actions heroui-modal-actions">
                {editingKeyId ? <Button variant="ghost" className="danger-action-button" onPress={() => onDeleteKey(editingKeyId)} isDisabled={saving}>Delete key</Button> : null}
                <Button variant="primary" onPress={onUpdateKey} isDisabled={saving} isPending={saving}>{saving ? "Updating..." : "Save name"}</Button>
              </div>
            </Card.Content>
          </Card>
        </div> : null}

        {isAccountModalOpen ? <div className="modal-overlay" onClick={() => setIsAccountModalOpen(false)}>
          <Card className="modal-card heroui-modal-card" onClick={(event) => event.stopPropagation()}>
            <Card.Content className="heroui-modal-content">
              <div className="section-heading heroui-section-heading">
                <h3>{editingAccountId ? "Edit gateway account" : "Add gateway account"}</h3>
                <Button variant="ghost" onPress={() => setIsAccountModalOpen(false)}>Close</Button>
              </div>
              <p className="muted-copy">Agar active account ka quota ya limit khatam ho jata hai, bridge automatic next configured active account par switch karega.</p>
              <label>
                <span>Account name</span>
                <Input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Account 2" />
              </label>
              <label>
                <span>Base URL</span>
                <Input value={accountBaseUrl} onChange={(event) => setAccountBaseUrl(event.target.value)} placeholder="https://api.openai.com" />
              </label>
              <label>
                <span>API key</span>
                <Input type="password" value={accountApiKey} onChange={(event) => setAccountApiKey(event.target.value)} placeholder="sk-..." />
              </label>
              <div className="actions-row modal-actions heroui-modal-actions">
                <Button variant="primary" onPress={onSaveAccount} isDisabled={saving} isPending={saving}>{saving ? "Saving..." : editingAccountId ? "Update account" : "Add account"}</Button>
              </div>
            </Card.Content>
          </Card>
        </div> : null}

      </main>
    </div>
  );
}
