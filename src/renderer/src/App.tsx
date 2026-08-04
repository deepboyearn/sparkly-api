import React, { Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Card, Input, Select } from "./components/ui";
import { Icon } from "@iconify/react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChartOptions } from "chart.js";
import { Line } from "react-chartjs-2";

import { V0_BASE_URL, V0_MODELS } from "../../shared/types";
import type { AccountProvider, AccountUsageTag, BridgeConfig, BridgeState, PlaygroundModelsResult, PlaygroundTestResult } from "../../shared/types";
import { emptyState, ensureBridgeMethod, getDayPoints, getHourlyPoints, getRequestPoints, getUsageRecords, groupKeyStats, groupModelStats, normalizeBridgeState } from "./appState";
import { logUserAction } from "./consoleLogStore";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { SectionKey } from "./components/Sidebar";
import { Onboarding } from "./components/Onboarding";

const OVERVIEW_RESET_MS = 5 * 60 * 60 * 1000;
const AccountsPage = React.lazy(() => import("./pages/AccountsPage"));
const ApiKeysPage = React.lazy(() => import("./pages/ApiKeysPage"));
const PlaygroundPage = React.lazy(() => import("./pages/PlaygroundPage"));
const UsagePage = React.lazy(() => import("./pages/UsagePage"));
const MITMPage = React.lazy(() => import("./pages/MITMPage"));
const ConsoleLogsPage = React.lazy(() => import("./pages/ConsoleLogsPage"));

const accountProviderOptions: Array<{ value: AccountProvider; label: string; description: string }> = [
  { value: "auto", label: "Auto detect", description: "Probe read-only catalogs, then persist the resolved protocol" },
  { value: "openai-compatible", label: "OpenAI compatible", description: "OpenAI Chat, Responses, and compatible gateways" },
  { value: "anthropic", label: "Anthropic", description: "Native Anthropic Models and Messages APIs" },
  { value: "gemini", label: "Google Gemini", description: "Gemini models and generateContent" },
  { value: "ollama", label: "Ollama", description: "Local Ollama tags and chat APIs" },
  { value: "cohere", label: "Cohere", description: "Cohere models and v2 Chat" },
  { value: "v0", label: "v0 Platform API", description: "Use v0 chat generation through api.v0.dev" },
];

export default function App() {
  const [state, setState] = useState<BridgeState>(emptyState);
  const [form, setForm] = useState<BridgeConfig>(emptyState.config);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ kind: "progress" | "success" | "error"; message: string } | null>(null);
  useEffect(() => {
    if (!actionNotice) return;
    const timer = window.setTimeout(() => setActionNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [requestTab, setRequestTab] = useState<"By Hour" | "By Day">("By Hour");
  const [tokenTab, setTokenTab] = useState<"By Hour" | "By Day">("By Hour");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const [isEditKeyOpen, setIsEditKeyOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const createKeyOverlayRef = useRef<HTMLDivElement>(null);
  const editKeyOverlayRef = useRef<HTMLDivElement>(null);
  const accountOverlayRef = useRef<HTMLDivElement>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editingKeyName, setEditingKeyName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountProvider, setAccountProvider] = useState<AccountProvider>("auto");
  const [accountBaseUrl, setAccountBaseUrl] = useState("https://api.bluesminds.com");
  const [accountApiKey, setAccountApiKey] = useState("");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountUsageTags, setAccountUsageTags] = useState<AccountUsageTag[]>(["coding"]);
  const [apiKeyModelQuery, setApiKeyModelQuery] = useState("");
  const [usageMode, setUsageMode] = useState<"statistics" | "records">("statistics");
  const [timeFilter, setTimeFilter] = useState<"24h" | "7d" | "30d" | "all">("24h");
  const [playgroundModelQuery, setPlaygroundModelQuery] = useState("");
  const [playgroundAvailableModels, setPlaygroundAvailableModels] = useState<string[]>([]);
  const [playgroundBaseUrl, setPlaygroundBaseUrl] = useState("https://api.bluesminds.com");
  const [playgroundApiKey, setPlaygroundApiKey] = useState("");
  const [playgroundModel, setPlaygroundModel] = useState("");
  const [playgroundSystemPrompt, setPlaygroundSystemPrompt] = useState("");
  const [playgroundMessage, setPlaygroundMessage] = useState("Hello");
  const [playgroundResult, setPlaygroundResult] = useState<PlaygroundTestResult | null>(null);
  const [playgroundModelsResult, setPlaygroundModelsResult] = useState<PlaygroundModelsResult | null>(null);
  const [playgroundModelsLoading, setPlaygroundModelsLoading] = useState(false);
  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  // Overview page: persist only the five-hour observation-window boundary.
  const [overviewWindowStart, setOverviewWindowStart] = useState(
    () => Date.now() - OVERVIEW_RESET_MS,
  );

  const onToggleCollapse = useCallback(() => setIsSidebarCollapsed(c => !c), []);
  const onNavigate = useCallback((section: SectionKey) => setActiveSection(section), []);

  // Exclude model probe requests so the dashboard reports client traffic separately.
  const realLogs = useMemo(() => state.logs.filter(log => log.requestType !== 'model_probe'), [state.logs]);

  const usageFilteredLogs = useMemo(() => {
    if (timeFilter === 'all') return realLogs;
    const now = Date.now();
    let ms = 24 * 60 * 60 * 1000;
    if (timeFilter === '7d') ms = 7 * 24 * 60 * 60 * 1000;
    if (timeFilter === '30d') ms = 30 * 24 * 60 * 60 * 1000;
    return realLogs.filter(log => now - new Date(log.timestamp).getTime() <= ms);
  }, [realLogs, timeFilter]);

  useEffect(() => {
    const storageKey = 'overview_window_start';
    const refreshWindow = () => {
      const stored = Number(localStorage.getItem(storageKey));
      const now = Date.now();
      const windowStart = Number.isFinite(stored) && stored > 0 && now - stored <= OVERVIEW_RESET_MS
        ? stored
        : now;
      if (windowStart !== stored) localStorage.setItem(storageKey, String(windowStart));
      setOverviewWindowStart(windowStart);
    };

    localStorage.removeItem('overview_token_usage');
    refreshWindow();
    const timer = setInterval(refreshWindow, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const overviewFilteredLogs = useMemo(() => {
    return realLogs.filter(log => new Date(log.timestamp).getTime() >= overviewWindowStart);
  }, [overviewWindowStart, realLogs]);

  const overviewSuccessCount = useMemo(() => (
    overviewFilteredLogs.filter((log) => log.status < 400).length
  ), [overviewFilteredLogs]);

  const overviewFailedCount = useMemo(() => (
    overviewFilteredLogs.filter((log) => log.status >= 400).length
  ), [overviewFilteredLogs]);

  const overviewSuccessRate = useMemo(() => (
    overviewFilteredLogs.length === 0 ? 100 : Math.round((overviewSuccessCount / overviewFilteredLogs.length) * 100)
  ), [overviewFilteredLogs.length, overviewSuccessCount]);

  const overviewCurrentRpm = useMemo(() => {
    const minuteAgo = Date.now() - 60_000;
    return overviewFilteredLogs.filter((log) => new Date(log.timestamp).getTime() >= minuteAgo).length;
  }, [overviewFilteredLogs]);

  const isOverview = activeSection === "overview";
  const isApiKeys = activeSection === "apiKeys";
  const isUsage = activeSection === "usage";
  const isAccounts = activeSection === "accounts";
  const isPlayground = activeSection === "playground";



  // Overview analytics: Only show last 5 hours
  const requestPoints = useMemo(() => (
    isOverview ? getRequestPoints(overviewFilteredLogs) : []
  ), [isOverview, overviewFilteredLogs]);
  const overviewMaxPoint = useMemo(() => (
    requestPoints.length > 0 ? Math.max(...requestPoints.map((point) => point.value), 1) : 1
  ), [requestPoints]);
  const probePoints = useMemo(() => (
    isOverview ? getRequestPoints(state.logs.filter(l => l.requestType === 'model_probe' && new Date(l.timestamp).getTime() >= overviewWindowStart)) : []
  ), [isOverview, overviewWindowStart, state.logs]);
  const overviewHasTraffic = useMemo(() => (
    requestPoints.some((point) => point.value > 0) || probePoints.some((point) => point.value > 0)
  ), [probePoints, requestPoints]);
  const requestTrendData = useMemo(() => ({
    labels: requestPoints.map((point) => point.label),
    datasets: [
      {
        label: "Requests",
        data: requestPoints.map((point) => point.value),
        borderColor: "#f07d2f",
        backgroundColor: "rgba(240, 125, 47, 0.2)",
        fill: true,
        tension: 0.42,
        borderWidth: 3,
        pointRadius: requestPoints.map((point) => point.value > 0 ? 4 : 2),
        pointHoverRadius: requestPoints.map((point) => point.value > 0 ? 7 : 4),
        pointBackgroundColor: "#f07d2f",
        pointBorderColor: "#141414",
        pointBorderWidth: 2,
        pointHoverBackgroundColor: "#ffb067",
        pointHoverBorderColor: "#22160d",
        hitRadius: 18,
        order: 2,
      },
      {
        label: "Model Probes",
        data: probePoints.map((point) => point.value),
        borderColor: "#a78bfa",
        backgroundColor: "rgba(167, 139, 250, 0.12)",
        fill: false,
        tension: 0.42,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: probePoints.map((point) => point.value > 0 ? 4 : 2),
        pointHoverRadius: probePoints.map((point) => point.value > 0 ? 6 : 4),
        pointBackgroundColor: "#a78bfa",
        pointBorderColor: "#a78bfa",
        pointBorderWidth: 2,
        pointHoverBackgroundColor: "#c4b5fd",
        pointHoverBorderColor: "#a78bfa",
        hitRadius: 18,
        order: 1,
      },
    ],
  }), [requestPoints, probePoints]);
  const requestTrendOptions = useMemo<ChartOptions<"line">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "top" as const,
        align: "end" as const,
        labels: {
          color: "rgba(255,255,255,0.5)",
          font: { family: "'Outfit', sans-serif", size: 11 },
          boxWidth: 12,
          boxHeight: 2,
          padding: 16,
          usePointStyle: true,
          pointStyle: "line",
        },
      },
      tooltip: {
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        backgroundColor: "rgba(10, 10, 12, 0.98)",
        borderColor: "rgba(255, 255, 255, 0.12)",
        borderWidth: 1,
        titleColor: "#f4f4f4",
        bodyColor: "#d0d0d0",
        titleFont: { family: "'Poppins', sans-serif", size: 11, weight: 700 },
        bodyFont: { family: "'Poppins', sans-serif", size: 11, weight: 600 },
        padding: 12,
        cornerRadius: 12,
        callbacks: {
          title: (items) => items[0]?.label ?? "",
          label: (context) => `${context.dataset.label}: ${context.parsed.y} requests`,
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
          autoSkip: true,
          maxTicksLimit: 6,
          maxRotation: 0,
          minRotation: 0,
          font: { family: "'Poppins', sans-serif", size: 10, weight: 600 },
        },
        border: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        suggestedMax: overviewHasTraffic ? overviewMaxPoint + Math.max(1, Math.ceil(overviewMaxPoint * 0.35)) : 2,
        ticks: {
          stepSize: overviewMaxPoint <= 4 ? 1 : Math.max(1, Math.ceil(overviewMaxPoint / 4)),
          color: "#9c9c9c",
          precision: 0,
          font: { family: "'Poppins', sans-serif", size: 10, weight: 600 },
        },
        grid: {
          color: "rgba(255, 255, 255, 0.05)",
          drawTicks: false,
        },
        border: {
          color: "rgba(255, 255, 255, 0.1)",
        },
      },
    },
    elements: {
      line: {
        cubicInterpolationMode: "monotone",
        capBezierPoints: true,
      },
    },
  }), [overviewHasTraffic, overviewMaxPoint]);
  const clientBaseUrl = "http://localhost:48231/v1";
  // Auto-reset logs older than 30 days
  useEffect(() => {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const hasOldLogs = state.logs.some(log => new Date(log.timestamp).getTime() < thirtyDaysAgo);

    if (hasOldLogs) {
      const filteredLogs = state.logs.filter(log => new Date(log.timestamp).getTime() >= thirtyDaysAgo);
      setState(prev => ({ ...prev, logs: filteredLogs }));
    }
  }, [state.logs.length]); // Check when logs are added or on mount

  const localClientKey = state.clientKeys[0]?.key ?? "local-bridge-client";
  const hourlyRequestPoints = useMemo(() => {
    if (!isUsage) return [];
    let count = 24;
    if (requestTab === "By Hour") {
      if (timeFilter === '7d') count = 7 * 24;
      if (timeFilter === '30d') count = 30 * 24;
      return getHourlyPoints(realLogs, "requests", count);
    } else {
      count = 14;
      if (timeFilter === '7d') count = 7;
      if (timeFilter === '30d') count = 30;
      if (timeFilter === 'all') count = 30;
      return getDayPoints(realLogs, "requests", count);
    }
  }, [isUsage, realLogs, requestTab, timeFilter]);

  const hourlyTokenPoints = useMemo(() => {
    if (!isUsage) return [];
    let count = 24;
    if (tokenTab === "By Hour") {
      if (timeFilter === '7d') count = 7 * 24;
      if (timeFilter === '30d') count = 30 * 24;
      return getHourlyPoints(realLogs, "tokens", count);
    } else {
      count = 14;
      if (timeFilter === '7d') count = 7;
      if (timeFilter === '30d') count = 30;
      if (timeFilter === 'all') count = 30;
      return getDayPoints(realLogs, "tokens", count);
    }
  }, [isUsage, realLogs, tokenTab, timeFilter]);

  const hourlyProbePoints = useMemo(() => {
    if (!isUsage) return [];
    const probeLogs = state.logs.filter(l => l.requestType === 'model_probe');
    let count = 24;
    if (requestTab === "By Hour") {
      if (timeFilter === '7d') count = 7 * 24;
      if (timeFilter === '30d') count = 30 * 24;
      return getHourlyPoints(probeLogs, "requests", count);
    } else {
      count = 14;
      if (timeFilter === '7d') count = 7;
      if (timeFilter === '30d') count = 30;
      if (timeFilter === 'all') count = 30;
      return getDayPoints(probeLogs, "requests", count);
    }
  }, [isUsage, state.logs, requestTab, timeFilter]);
  const maxHourlyRequest = useMemo(() => (
    hourlyRequestPoints.length > 0 ? Math.max(...hourlyRequestPoints.map((point) => point.value), 1) : 1
  ), [hourlyRequestPoints]);
  const maxHourlyToken = useMemo(() => (
    hourlyTokenPoints.length > 0 ? Math.max(...hourlyTokenPoints.map((point) => point.value), 1) : 1
  ), [hourlyTokenPoints]);
  const usageRequestChartData = useMemo(() => ({
    labels: hourlyRequestPoints.map((point) => point.label),
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
        order: 2,
      },
      {
        label: "Model Probes",
        data: hourlyProbePoints.map((point) => point.value),
        borderColor: "#a78bfa",
        backgroundColor: "rgba(167, 139, 250, 0.12)",
        fill: false,
        tension: 0.36,
        borderWidth: 3,
        borderDash: [6, 4],
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#a78bfa",
        pointBorderColor: "#a78bfa",
        pointBorderWidth: 2,
        order: 1,
      },
    ],
  }), [hourlyRequestPoints, hourlyProbePoints]);
  const usageTokenChartData = useMemo(() => ({
    labels: hourlyTokenPoints.map((point) => point.label),
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
        order: 2,
      },
    ],
  }), [hourlyTokenPoints]);

  const usageRequestChartOptions = useMemo<ChartOptions<"line">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "top" as const,
        align: "end" as const,
        labels: {
          color: "rgba(255,255,255,0.5)",
          font: { family: "'Outfit', sans-serif", size: 10 },
          boxWidth: 10,
          boxHeight: 2,
          usePointStyle: true,
          pointStyle: "line",
        },
      },
      tooltip: {
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        backgroundColor: "rgba(20, 20, 20, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 1,
        titleColor: "#f4f4f4",
        bodyColor: "#d0d0d0",
        padding: 12,
        callbacks: {
          label: (context) => `${context.dataset.label}: ${context.parsed.y}`,
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
      legend: {
        display: true,
        position: "top" as const,
        align: "end" as const,
        labels: {
          color: "rgba(255,255,255,0.5)",
          font: { family: "'Outfit', sans-serif", size: 10 },
          boxWidth: 10,
          boxHeight: 2,
          usePointStyle: true,
          pointStyle: "line",
        },
      },
      tooltip: {
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        backgroundColor: "rgba(20, 20, 20, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 1,
        titleColor: "#f4f4f4",
        bodyColor: "#d0d0d0",
        padding: 12,
        callbacks: {
          label: (context) => `${context.dataset.label}: ${context.parsed.y}`,
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
    isUsage ? groupModelStats(usageFilteredLogs) : []
  ), [isUsage, usageFilteredLogs]);
  const keyStats = useMemo(() => (
    isUsage ? groupKeyStats(usageFilteredLogs, state.clientKeys) : []
  ), [isUsage, state.clientKeys, usageFilteredLogs]);
  const rpm = useMemo(() => (
    isUsage ? usageFilteredLogs.filter((entry) => Date.now() - new Date(entry.timestamp).getTime() <= 60_000).length : 0
  ), [isUsage, usageFilteredLogs]);
  const usageRecords = useMemo(() => (
    isUsage ? getUsageRecords(usageFilteredLogs, state.clientKeys, state.config.apiKey) : []
  ), [isUsage, state.clientKeys, state.config.apiKey, usageFilteredLogs]);

  function applyLoadedBridgeState(nextState: Partial<BridgeState>) {
    const normalized = normalizeBridgeState(nextState);
    setState(normalized);
    setForm(normalized.config);
    return normalized;
  }

  function syncPlaygroundToAccount(nextState: BridgeState, accountId?: string) {
    const account = nextState.config.accounts.find((candidate) => candidate.id === (accountId ?? nextState.config.activeAccountId))
      ?? nextState.config.accounts[0];
    const nextModels = account?.models ?? nextState.config.models;
    const nextModel = account?.selectedModel || nextModels[0] || "";
    setPlaygroundAvailableModels(nextModels);
    setPlaygroundBaseUrl(account?.baseUrl ?? nextState.config.upstreamBaseUrl);
    setPlaygroundApiKey(account?.apiKey ?? nextState.config.apiKey);
    setPlaygroundModel(nextModel);
    setPlaygroundModelQuery(nextModel);
  }

  async function refresh() {
    if (!window.bridgeApi) {
      console.warn("The native Tauri API is unavailable. Sparkly API must run inside its desktop application.");
      setLoading(false);
      return;
    }
    try {
      const nextState = applyLoadedBridgeState(await window.bridgeApi.getState());
      syncPlaygroundToAccount(nextState);

      if (loading) {
        setActiveSection("overview");
      }
    } catch (err) {
      console.error("Failed to fetch initial state:", err);
    } finally {
      setLoading(false);
    }
  }

  async function persistConfig(nextForm: BridgeConfig) {
    const savedState = applyLoadedBridgeState(await window.bridgeApi?.saveConfig({
      ...nextForm,
      models: nextForm.models,
    }));
    logUserAction("Configuration saved");
    return savedState;
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
      window.bridgeApi?.getRuntimeSnapshot()
        ?.then((snapshot) => {
          startTransition(() => {
            setState((prev) => normalizeBridgeState({
              config: prev.config,
              clientKeys: prev.clientKeys,
              stats: snapshot.stats,
              logs: snapshot.logs,
            }, prev));
          });
        })
        ?.catch(() => undefined);
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [isAccountModalOpen, isCreateKeyOpen, isEditKeyOpen, playgroundLoading, playgroundModelsLoading, saving]);

  async function onSave(optionalForm?: BridgeConfig) {
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Saving configuration..." });
    try {
      await persistConfig(optionalForm || form);
      setActionNotice({ kind: "success", message: "Configuration saved." });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save configuration";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  async function onRestart() {
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Restarting the local bridge on localhost:48231..." });
    try {
      applyLoadedBridgeState(await ensureBridgeMethod("restartServer")());
      logUserAction("Server restarted");
      setActionNotice({ kind: "success", message: "Local bridge restarted on localhost:48231." });
    } catch (restartError) {
      const message = restartError instanceof Error ? restartError.message : "Failed to restart local server";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  async function onCreateKey() {
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Creating client key..." });
    try {
      const nextState = applyLoadedBridgeState(await ensureBridgeMethod("createClientKey")({ name: newKeyName }));
      setNewKeyName("");
      setIsCreateKeyOpen(false);
      logUserAction(`Client key created: ${newKeyName}`);
      setActionNotice({ kind: "success", message: `Client key ${nextState.clientKeys[0]?.name ?? "created"} is ready.` });
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Failed to create client key";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  async function onUpdateKey() {
    if (!editingKeyId) return;
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Updating client key..." });
    try {
      applyLoadedBridgeState(await ensureBridgeMethod("updateClientKey")({
        id: editingKeyId,
        name: editingKeyName,
      }));
      setIsEditKeyOpen(false);
      setEditingKeyId(null);
      setEditingKeyName("");
      setActionNotice({ kind: "success", message: "Client key updated." });
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Failed to update client key";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteKey(id: string) {
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Deleting client key..." });
    try {
      applyLoadedBridgeState(await ensureBridgeMethod("deleteClientKey")({ id }));
      if (editingKeyId === id) {
        setIsEditKeyOpen(false);
        setEditingKeyId(null);
        setEditingKeyName("");
      }
      setActionNotice({ kind: "success", message: "Client key deleted." });
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Failed to delete client key";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  function openEditKeyModal(id: string, name: string) {
    setEditingKeyId(id);
    setEditingKeyName(name);
    setIsEditKeyOpen(true);
  }

  async function onSaveAccount() {
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: editingAccountId ? "Updating provider account..." : "Adding provider account..." });
    try {
      const result = editingAccountId
        ? await ensureBridgeMethod("updateAccount")({
          id: editingAccountId,
          name: accountName,
          provider: accountProvider,
          baseUrl: accountBaseUrl,
          apiKey: accountApiKey,
          usageTags: accountUsageTags,
          isActive: true,
        })
        : await ensureBridgeMethod("createAccount")({
          name: accountName,
          provider: accountProvider,
          baseUrl: accountBaseUrl,
          apiKey: accountApiKey,
          usageTags: accountUsageTags,
        });

      applyLoadedBridgeState(result);
      setIsAccountModalOpen(false);
      setEditingAccountId(null);
      setAccountName("");
      setAccountProvider("auto");
      setAccountBaseUrl("https://api.bluesminds.com");
      setAccountApiKey("");
      setAccountUsageTags(["coding"]);
      logUserAction(editingAccountId ? `Account updated: ${accountName}` : `Account added: ${accountName}`);
      setActionNotice({ kind: "success", message: editingAccountId ? `Provider account ${accountName} updated.` : `Provider account ${accountName} added.` });
    } catch (accountError) {
      const message = accountError instanceof Error ? accountError.message : "Failed to save account";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteAccount(id: string) {
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Deleting provider account..." });
    try {
      applyLoadedBridgeState(await ensureBridgeMethod("deleteAccount")({ id }));
      logUserAction("Account deleted");
      setActionNotice({ kind: "success", message: "Provider account deleted." });
    } catch (accountError) {
      const message = accountError instanceof Error ? accountError.message : "Failed to delete account";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  async function onSelectAccount(id: string) {
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Switching active provider account..." });
    try {
      const nextState = applyLoadedBridgeState(await ensureBridgeMethod("selectAccount")({ id }));
      syncPlaygroundToAccount(nextState, id);
      const activeAccount = nextState.config.accounts.find((account) => account.id === nextState.config.activeAccountId);
      setActionNotice({ kind: "success", message: `${activeAccount?.name ?? "Provider account"} is now active with ${(activeAccount?.models.length ?? 0).toLocaleString()} models.` });
    } catch (accountError) {
      const message = accountError instanceof Error ? accountError.message : "Failed to select account";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  function openCreateAccountModal() {
    setEditingAccountId(null);
    setAccountName("");
    setAccountProvider("auto");
    setAccountBaseUrl("https://api.bluesminds.com");
    setAccountApiKey("");
    setAccountUsageTags(["coding"]);
    setIsAccountModalOpen(true);
  }

  function openEditAccountModal(account: BridgeState["config"]["accounts"][number]) {
    setEditingAccountId(account.id);
    setAccountName(account.name);
    setAccountProvider(account.provider ?? "auto");
    setAccountBaseUrl(account.baseUrl);
    setAccountApiKey(account.apiKey);
    setAccountUsageTags(account.usageTags);
    setIsAccountModalOpen(true);
  }

  function onSelectAccountProvider(provider: AccountProvider) {
    setAccountProvider(provider);
    if (provider === "v0") {
      setAccountName((current) => current.trim() ? current : "v0");
      setAccountBaseUrl(V0_BASE_URL);
      setAccountUsageTags(["coding"]);
      setForm((current) => ({
        ...current,
        models: Array.from(new Set([...current.models, ...V0_MODELS])),
        selectedModel: (V0_MODELS as readonly string[]).includes(current.selectedModel) ? current.selectedModel : V0_MODELS[0],
      }));
      return;
    }

    const defaults: Partial<Record<AccountProvider, { name: string; baseUrl: string }>> = {
      anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com" },
      gemini: { name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
      ollama: { name: "Ollama", baseUrl: "http://localhost:11434" },
      cohere: { name: "Cohere", baseUrl: "https://api.cohere.com" },
    };
    const selectedDefault = defaults[provider];
    if (selectedDefault) {
      setAccountName((current) => current.trim() ? current : selectedDefault.name);
      setAccountBaseUrl(selectedDefault.baseUrl);
      setAccountUsageTags(["coding"]);
      return;
    }

    setAccountBaseUrl((current) =>
      [V0_BASE_URL, "https://api.anthropic.com", "https://generativelanguage.googleapis.com/v1beta", "http://localhost:11434", "https://api.cohere.com"].includes(current)
        ? ""
        : current
    );
  }

  async function onRefreshActiveAccountModels() {
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Scanning all compatible model catalog endpoints..." });
    try {
      const nextState = applyLoadedBridgeState(await ensureBridgeMethod("refreshActiveAccountModels")());
      const activeAccount = nextState.config.accounts.find((account) => account.id === nextState.config.activeAccountId);
      const refreshedModels = activeAccount?.models ?? nextState.config.models;
      setApiKeyModelQuery("");
      setPlaygroundAvailableModels(refreshedModels);
      setPlaygroundModel((currentModel) => {
        const nextModel = currentModel && refreshedModels.includes(currentModel)
          ? currentModel
          : activeAccount?.selectedModel || refreshedModels[0] || "";
        setPlaygroundModelQuery(nextModel);
        return nextModel;
      });
      setActionNotice({ kind: "success", message: `Loaded ${(activeAccount?.models.length ?? nextState.config.models.length).toLocaleString()} models from ${activeAccount?.name ?? "the active provider"}.` });
    } catch (accountError) {
      const message = accountError instanceof Error ? accountError.message : "Failed to refresh active account models";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  async function onRunPlayground(input: import("../../shared/types").PlaygroundTestInput) {
    setPlaygroundLoading(true);
    setError(null);
    setActionNotice({ kind: "progress", message: `Running Playground request with ${input.model}...` });
    try {
      const result = await ensureBridgeMethod("playgroundTest")(input);
      setPlaygroundResult(result);
      setActionNotice({
        kind: result.ok ? "success" : "error",
        message: result.ok ? `Playground request completed with ${result.model || input.model}.` : result.error || `Playground request failed with HTTP ${result.status}.`,
      });
    } catch (playgroundError) {
      const message = playgroundError instanceof Error ? playgroundError.message : "Playground request failed";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setPlaygroundLoading(false);
    }
  }

  async function onLoadPlaygroundModels(protocol: Exclude<AccountProvider, "auto" | "v0">) {
    setPlaygroundModelsLoading(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Loading models for this Playground endpoint..." });
    try {
      const result = await ensureBridgeMethod("playgroundLoadModels")({
        baseUrl: playgroundBaseUrl.trim().replace(/\/+$/, ""),
        apiKey: playgroundApiKey,
        protocol,
      });
      setPlaygroundModelsResult(result);
      if (result.ok) {
        setPlaygroundAvailableModels(result.models);
        setPlaygroundModel((currentModel) => {
          if (currentModel && result.models.includes(currentModel)) return currentModel;
          const nextModel = currentModel || result.models[0] || "";
          if (nextModel !== currentModel) setPlaygroundModelQuery(nextModel);
          return nextModel;
        });
        setActionNotice({ kind: "success", message: `Loaded ${result.models.length.toLocaleString()} transient Playground models. Save or scan the account to persist its catalog.` });
      } else {
        setActionNotice({ kind: "error", message: result.error || `Model discovery failed with HTTP ${result.status}.` });
      }
    } catch (modelsError) {
      const message = modelsError instanceof Error ? modelsError.message : "Failed to load models";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setPlaygroundModelsLoading(false);
    }
  }

  // Auto-focus modal overlays when opened
  useEffect(() => {
    if (isCreateKeyOpen) createKeyOverlayRef.current?.focus();
  }, [isCreateKeyOpen]);
  useEffect(() => {
    if (isEditKeyOpen) editKeyOverlayRef.current?.focus();
  }, [isEditKeyOpen]);
  useEffect(() => {
    if (isAccountModalOpen) accountOverlayRef.current?.focus();
  }, [isAccountModalOpen]);

  async function onResetUsage() {
    if (!confirm("Are you sure you want to reset all usage data? This cannot be undone.")) return;
    setSaving(true);
    setError(null);
    setActionNotice({ kind: "progress", message: "Resetting usage data..." });
    try {
      applyLoadedBridgeState(await ensureBridgeMethod("resetUsage")({ confirm: true }));
      setActionNotice({ kind: "success", message: "Usage data reset." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reset usage data";
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <motion.div
      initial={{ opacity: 0, }}
      animate={{ opacity: 1, }}
      className="screen centered"
      style={{ background: '#000', color: '#fff', fontSize: '14px', letterSpacing: '1px' }}
    >
      <Icon icon="solar:refresh-bold-duotone" className="animate-spin mr-3" width={24} />
      Loading bridge system...
    </motion.div>
  );
  if (showOnboarding) return <Onboarding onComplete={() => setShowOnboarding(false)} />;

  return (
    <>
      <div className="screen dashboard-shell heroui-dashboard-shell" style={{ display: 'grid', gridTemplateColumns: isSidebarCollapsed ? '88px 1fr' : '280px 1fr', transition: 'grid-template-columns 0.3s ease', height: '100vh', overflow: 'hidden' }}>
        <Sidebar
          activeSection={activeSection}
          setActiveSection={onNavigate}
          serverRunning={state.stats.serverRunning}
          setError={setError}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={onToggleCollapse}
        />

        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
          <Header
            section={activeSection}
            saving={saving}
            playgroundLoading={playgroundLoading}
            onRestart={onRestart}
            onReset={activeSection === "usage" ? onResetUsage : undefined}
            onPrimaryAction={isUsage ? refresh : isAccounts ? openCreateAccountModal : isPlayground ? () => setActionNotice({ kind: "progress", message: "Configure the Playground workbench, then use Execute request." }) : onSave}
          />

          <main className="" style={{ flex: 1, overflowY: 'auto', padding: '10px 20px' }}>
            <div className="interaction-status-region" role="status" aria-live="polite" aria-atomic="true">
              {actionNotice ? (
                <Alert status={actionNotice.kind === "error" ? "danger" : actionNotice.kind === "success" ? "success" : "info"} title={actionNotice.message} className="interaction-status-alert" />
              ) : null}
            </div>
            {error && error !== actionNotice?.message ? (
              <Alert status="danger" title={error} className="mb-4 border border-red-500/20 bg-red-500/10 text-white" />
            ) : null}

            <ErrorBoundary>
            <Suspense fallback={<div style={{ padding: 40, color: '#888' }}>Loading...</div>}>
              <AnimatePresence mode="wait">
                {isOverview ? (
                  <motion.div
                    key="overview"
                    initial={{ opacity: 0, y: 15, }}
                    animate={{ opacity: 1, y: 0, }}
                    exit={{ opacity: 0, y: -15, }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <motion.section
                      className="stats-grid"
                      variants={{
                        hidden: { opacity: 0 },
                        show: {
                          opacity: 1,
                          transition: {
                            staggerChildren: 0.08,
                            delayChildren: 0.1
                          }
                        }
                      }}
                      initial="hidden"
                      animate="show"
                    >
                      <motion.div variants={{ hidden: { opacity: 0, y: 20, }, show: { opacity: 1, y: 0, } }} whileHover={{ y: -5, transition: { duration: 0.2 } }}>
                        <Card className="metric-card">
                          <Card.Content className="metric-card-content">
                            <div className="metric-head">
                              <span className="metric-title">Today's requests</span>
                              <div className="metric-icon-circle green">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" fillRule="evenodd" d="M3.464 3.464C2 4.93 2 7.286 2 12s0 7.071 1.464 8.535C4.93 22 7.286 22 12 22s7.071 0 8.535-1.465C22 19.072 22 16.714 22 12s0-7.071-1.465-8.536C19.072 2 16.714 2 12 2S4.929 2 3.464 3.464M13.75 10c0 .414.336.75.75.75h.69l-2.013 2.013a.25.25 0 0 1-.354 0l-1.586-1.586a1.75 1.75 0 0 0-2.474 0L6.47 13.47a.75.75 0 1 0 1.06 1.06l2.293-2.293a.25.25 0 0 1 .354 0l1.586 1.586a1.75 1.75 0 0 0 2.474 0l2.013-2.012v.689a.75.75 0 0 0 1.5 0V10a.75.75 0 0 0-.75-.75h-2.5a.75.75 0 0 0-.75.75" clipRule="evenodd" strokeWidth="0.5" stroke="currentColor" /></svg>
                              </div>
                            </div>
                            <strong>{overviewFilteredLogs.length}</strong>
                            <p>Success: {overviewSuccessCount} / Failed: {overviewFailedCount}</p>

                          </Card.Content>
                        </Card>
                      </motion.div>

                      <motion.div variants={{ hidden: { opacity: 0, y: 20, }, show: { opacity: 1, y: 0, } }} whileHover={{ y: -5, transition: { duration: 0.2 } }}>
                        <Card className="metric-card">
                          <Card.Content className="metric-card-content">
                            <div className="metric-head">
                              <span className="metric-title">Today's tokens</span>
                              <div className="metric-icon-circle orange">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 512 512"><path fill="currentColor" d="M256 117c-65.2 0-124.2 11.6-166.13 29.7c-20.95 9.1-37.57 19.8-48.57 31.1S25 200.4 25 212s5.3 22.9 16.3 34.2s27.62 22 48.57 31.1C131.8 295.4 190.8 307 256 307s124.2-11.6 166.1-29.7c21-9.1 37.6-19.8 48.6-31.1S487 223.6 487 212s-5.3-22.9-16.3-34.2s-27.6-22-48.6-31.1C380.2 128.6 321.2 117 256 117M25 255.1v50.2c0 6.3 5.3 17.6 16.3 28.9s27.62 22 48.57 31.1C131.8 383.4 190.8 395 256 395s124.2-11.6 166.1-29.7c21-9.1 37.6-19.8 48.6-31.1s16.3-22.6 16.3-28.9v-50.2c-1.1 1.3-2.2 2.5-3.4 3.7c-13.3 13.6-31.8 25.3-54.3 35c-45 19.5-106 31.2-173.3 31.2s-128.3-11.7-173.28-31.2c-22.49-9.7-41.01-21.4-54.3-35c-1.19-1.2-2.32-2.5-3.42-3.7" strokeWidth="13" stroke="currentColor" /></svg>
                              </div>
                            </div>
                            <strong>0</strong>
                            <p>Provider-reported usage is not available yet.</p>

                          </Card.Content>
                        </Card>
                      </motion.div>

                      <motion.div variants={{ hidden: { opacity: 0, y: 20, }, show: { opacity: 1, y: 0, } }} whileHover={{ y: -5, transition: { duration: 0.2 } }}>
                        <Card className="metric-card">
                          <Card.Content className="metric-card-content">
                            <div className="metric-head">
                              <span className="metric-title">Current traffic</span>
                              <div className="metric-icon-circle green">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M17 3.34a10 10 0 1 1-14.995 8.984L2 12l.005-.324A10 10 0 0 1 17 3.34M12 6a1 1 0 0 0-.993.883L11 7v5l.009.131a1 1 0 0 0 .197.477l.087.1l3 3l.094.082a1 1 0 0 0 1.226 0l.094-.083l.083-.094a1 1 0 0 0 0-1.226l-.083-.094L13 11.585V7l-.007-.117A1 1 0 0 0 12 6" strokeWidth="0.5" stroke="currentColor" /></svg>
                              </div>
                            </div>
                            <strong>{overviewCurrentRpm.toFixed(1)} RPM</strong>
                            <p>No artificial local limit is being reported.</p>

                          </Card.Content>
                        </Card>
                      </motion.div>

                      <motion.div variants={{ hidden: { opacity: 0, y: 20, }, show: { opacity: 1, y: 0, } }} whileHover={{ y: -5, transition: { duration: 0.2 } }}>
                        <Card className="metric-card">
                          <Card.Content className="metric-card-content">
                            <div className="metric-head">
                              <span className="metric-title">Active Keys</span>
                              <div className="metric-icon-circle blue">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 512 512"><path fill="currentColor" d="M218.1 167.2c0 13 0 25.6 4.1 37.4c-43.1 50.6-167.5 194.5-167.5 194.5l2.9 36.3s34.8 33 40 28c15.4-15 24.8-25.2 24.8-25.2l7.24-43.35l47.11-3.47l3.78-46.8l49.63-.95l.49-50.09l52.69 2.1l9-18.84c15.5 6.7 29.6 9.4 47.7 9.4c68.5 0 124-53.4 124-119.2S408.5 48 340 48s-121.9 53.4-121.9 119.2M406.85 144A38.85 38.85 0 1 1 368 105.15A38.81 38.81 0 0 1 406.85 144" strokeWidth="13" stroke="currentColor" /></svg>
                              </div>
                            </div>
                            <strong>{state.clientKeys.length}</strong>
                            <p>Max 10</p>

                          </Card.Content>
                        </Card>
                      </motion.div>
                    </motion.section>

                    <section className="content-grid overview-main-grid">
                      <motion.article
                        className="admin-panel chart-panel"
                        initial={{ opacity: 0, scale: 0.98, }}
                        animate={{ opacity: 1, scale: 1, }}
                        transition={{ delay: 0.4, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <div className="section-heading">
                          <h3>Request trends (Reset every 5 Hours)</h3>
                          <span className="status-pill success">LIVE</span>
                        </div>
                        <div className="overview-chart-stats">
                          <div className="overview-chart-stat"><span>Total requests</span><strong>{overviewFilteredLogs.length}</strong></div>
                          <div className="overview-chart-stat"><span>Success rate</span><strong>{overviewSuccessRate}%</strong></div>
                          <div className="overview-chart-stat"><span>Selected model</span><strong>{state.config.selectedModel || "None"}</strong></div>
                        </div>
                        <div className="chartjs-shell overview-chart-shell" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.008) 100%)', borderRadius: '20px', padding: '18px 18px 12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <Line data={requestTrendData} options={requestTrendOptions} />
                        </div>
                      </motion.article>

                      <motion.article
                        className="admin-panel activity-panel overview-activity-panel"
                        initial={{ opacity: 0, x: 20, }}
                        animate={{ opacity: 1, x: 0, }}
                        transition={{ delay: 0.5, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <div className="section-heading">
                          <h3>Recent activity</h3>
                          <button className="premium-button ghost sm" onClick={() => refresh()}>
                            <Icon icon="solar:refresh-bold" className="btn-icon" />
                            Refresh
                          </button>
                        </div>
                        {overviewFilteredLogs.length === 0 ? <div className="empty-logs dark-empty" style={{ background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '14px', padding: '32px' }}>No activity yet.</div> : null}
                        <div className="activity-list">
                          {overviewFilteredLogs.slice(0, 6).map((entry) => (
                            <div className="activity-item" key={entry.id}>
                              <div className="activity-info">
                                <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {entry.path}
                                  {entry.requestType === 'model_probe' && (
                                    <span style={{
                                      fontSize: '9px', fontWeight: 800, padding: '1px 5px',
                                      background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8',
                                      border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '3px',
                                      textTransform: 'uppercase', letterSpacing: '0.05em'
                                    }}>Model Probe</span>
                                  )}
                                </strong>
                                <p>{entry.requestType === 'model_probe' ? 'Auto-triggered by client model switch' : (entry.model ?? "No model")}</p>
                              </div>
                              <div className="activity-meta">
                                <span className={`status-badge ${entry.status >= 400 ? "status-bad" : "status-good"}`}>
                                  {entry.status} {entry.status >= 400 ? 'Error' : 'Success'}
                                </span>
                                <span className="activity-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.article>
                    </section>

                    <motion.section
                      className="content-grid lower-grid overview-lower-grid"
                      initial={{ opacity: 0, y: 20, }}
                      animate={{ opacity: 1, y: 0, }}
                      transition={{ delay: 0.6, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <article className="admin-panel settings-panel overview-settings-panel">
                        <div className="settings-content-wrap split-layout" style={{ gap: '24px' }}>
                          <div className="settings-column" style={{ flex: 1 }}>
                            <div className="section-heading" style={{ marginBottom: '12px' }}>
                              <h3 style={{ fontSize: '14px', opacity: 0.8 }}>Local API endpoint</h3>
                            </div>
                            <div className="settings-sub-card">
                              <div className="inline-setting-row no-bg" style={{ margin: 0, border: 'none', background: 'transparent' }}>
                                <span>Permanent client URL</span>
                                <code>http://localhost:48231</code>
                              </div>
                            </div>
                          </div>

                          <div className="settings-column" style={{ flex: 1 }}>
                            <div className="section-heading" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <h3 style={{ fontSize: '14px', opacity: 0.8 }}>Community & Support</h3>
                              <span style={{ fontSize: '10px', color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.05em' }}>(Sparkly Official)</span>
                            </div>
                            <div className="settings-sub-card support-sub-card" style={{ margin: 0, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <div className="inline-support-links">
                                <a href="https://t.me/sparklydeep" target="_blank" rel="noreferrer" className="footer-support-btn tg">Telegram</a>
                                <a href="https://discord.gg/dH2GJX8X7" target="_blank" rel="noreferrer" className="footer-support-btn ds">Discord</a>
                              </div>
                            </div>
                          </div>
                        </div>
                      </article>
                    </motion.section>
                  </motion.div>
                ) : isApiKeys ? (
                  <motion.div
                    key="apiKeys"
                    initial={{ opacity: 0, y: 15, }}
                    animate={{ opacity: 1, y: 0, }}
                    exit={{ opacity: 0, y: -15, }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <ApiKeysPage
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
                      onOpenCreateKey={() => { setNewKeyName(""); setIsCreateKeyOpen(true); }}
                      onSave={onSave}
                    />
                  </motion.div>
                ) : isUsage ? (
                  <motion.div
                    key="usage"
                    initial={{ opacity: 0, y: 15, }}
                    animate={{ opacity: 1, y: 0, }}
                    exit={{ opacity: 0, y: -15, }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <UsagePage
                      usageMode={usageMode}
                      setUsageMode={setUsageMode}
                      state={state}
                      realLogs={realLogs}
                      rpm={rpm}
                      usageRequestChartData={usageRequestChartData}
                      usageRequestChartOptions={usageRequestChartOptions}
                      usageTokenChartData={usageTokenChartData}
                      usageTokenChartOptions={usageTokenChartOptions}
                      modelStats={modelStats}
                      keyStats={keyStats}
                      usageRecords={usageRecords}
                      requestTab={requestTab}
                      setRequestTab={setRequestTab}
                      tokenTab={tokenTab}
                      setTokenTab={setTokenTab}
                      timeFilter={timeFilter}
                      setTimeFilter={setTimeFilter}
                    />
                  </motion.div>
                ) : isAccounts ? (
                  <motion.div
                    key="accounts"
                    initial={{ opacity: 0, y: 15, }}
                    animate={{ opacity: 1, y: 0, }}
                    exit={{ opacity: 0, y: -15, }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <AccountsPage
                      state={state}
                      saving={saving}
                      onRefreshActiveAccountModels={onRefreshActiveAccountModels}
                      openEditAccountModal={openEditAccountModal}
                      onSelectAccount={onSelectAccount}
                      onDeleteAccount={onDeleteAccount}
                    />
                  </motion.div>
                ) : isPlayground ? (
                  <motion.div
                    key="playground"
                    initial={{ opacity: 0, y: 15, }}
                    animate={{ opacity: 1, y: 0, }}
                    exit={{ opacity: 0, y: -15, }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <PlaygroundPage
                      accounts={state.config.accounts}
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
                      playgroundLoading={playgroundLoading}
                      onLoadPlaygroundModels={onLoadPlaygroundModels}
                      onRunPlayground={onRunPlayground}
                    />
                  </motion.div>
                ) : activeSection === "mitm" ? (
                  <motion.div
                    key="mitm"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <MITMPage accounts={state.config.accounts} activeAccountId={state.config.activeAccountId} onSelectAccount={onSelectAccount} />
                  </motion.div>
                ) : activeSection === "consoleLogs" ? (
                  <motion.div
                    key="consoleLogs"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <ConsoleLogsPage />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </Suspense>
            </ErrorBoundary>
          </main>

          <AnimatePresence>
            {isCreateKeyOpen && (
              <div
                className="modal-overlay"
                ref={createKeyOverlayRef}
                tabIndex={-1}
                onClick={() => setIsCreateKeyOpen(false)}
                onKeyDown={(e) => { if (e.key === 'Escape') setIsCreateKeyOpen(false); }}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, }}
                  animate={{ opacity: 1, scale: 1, }}
                  exit={{ opacity: 0, scale: 0.9, }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  style={{ width: '100%', maxWidth: '480px' }}
                >
                  <Card className="modal-card heroui-modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                    <Card.Content className="heroui-modal-content">
                      <div className="section-heading heroui-section-heading">
                        <h3>Create key</h3>
                        <button className="premium-button ghost sm" onClick={() => setIsCreateKeyOpen(false)}>
                          <Icon icon="solar:close-circle-bold-duotone" className="btn-icon" />Close
                        </button>
                      </div>
                      <label><span>Name</span><Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} /></label>
                      <div className="actions-row modal-actions heroui-modal-actions">
                        <button className="premium-button primary" onClick={onCreateKey} disabled={saving}>
                          <Icon icon="solar:key-bold-duotone" className="btn-icon" />
                          {saving ? "Creating..." : "Generate Key"}
                        </button>
                      </div>
                    </Card.Content>
                  </Card>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isEditKeyOpen && (
              <div
                className="modal-overlay"
                ref={editKeyOverlayRef}
                tabIndex={-1}
                onClick={() => setIsEditKeyOpen(false)}
                onKeyDown={(e) => { if (e.key === 'Escape') setIsEditKeyOpen(false); }}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, }}
                  animate={{ opacity: 1, scale: 1, }}
                  exit={{ opacity: 0, scale: 0.9, }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  style={{ width: '100%', maxWidth: '480px' }}
                >
                  <Card className="modal-card heroui-modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                    <Card.Content className="heroui-modal-content">
                      <div className="section-heading heroui-section-heading">
                        <h3>Edit key</h3>
                        <button className="premium-button ghost sm" onClick={() => setIsEditKeyOpen(false)}>
                          <Icon icon="solar:close-circle-bold-duotone" className="btn-icon" />Close
                        </button>
                      </div>
                      <label><span>Name</span><Input value={editingKeyName} onChange={(e) => setEditingKeyName(e.target.value)} /></label>
                      <div className="actions-row modal-actions heroui-modal-actions">
                        <button className="premium-button primary" onClick={onUpdateKey} disabled={saving}>
                          <Icon icon="solar:pen-new-square-bold-duotone" className="btn-icon" />Update Key
                        </button>
                      </div>
                    </Card.Content>
                  </Card>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isAccountModalOpen && (
              <div
                className="modal-overlay"
                ref={accountOverlayRef}
                tabIndex={-1}
                onClick={() => setIsAccountModalOpen(false)}
                onKeyDown={(e) => { if (e.key === 'Escape') setIsAccountModalOpen(false); }}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, }}
                  animate={{ opacity: 1, scale: 1, }}
                  exit={{ opacity: 0, scale: 0.9, }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  style={{ width: '100%', maxWidth: '560px' }}
                >
                  <Card className="modal-card heroui-modal-card account-modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                    <Card.Content className="heroui-modal-content account-modal-content">
                      <div className="account-modal-header">
                        <div className="account-modal-title-row">
                          <div className="account-modal-icon">
                            <Icon icon={editingAccountId ? "solar:pen-new-square-bold-duotone" : "solar:user-plus-bold-duotone"} />
                          </div>
                          <div>
                            <h3>{editingAccountId ? "Edit account" : "Add account"}</h3>
                            <p>Provider, API key aur usage type configure karein.</p>
                          </div>
                        </div>
                        <button className="premium-button ghost sm" onClick={() => setIsAccountModalOpen(false)}>
                          <Icon icon="solar:close-circle-bold-duotone" className="btn-icon" />Close
                        </button>
                      </div>
                      <label className="account-modal-field">
                        <span>Name</span>
                        <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Example: v0 primary" />
                      </label>
                      <label className="account-modal-field">
                        <span>Provider</span>
                        <Select
                          options={accountProviderOptions}
                          value={accountProvider}
                          onChange={(val) => onSelectAccountProvider(val as AccountProvider)}
                        />
                      </label>
                      <label className="account-modal-field">
                        <span>Base URL</span>
                        <Input value={accountBaseUrl} onChange={(e) => setAccountBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
                      </label>
                      <label className="account-modal-field">
                        <span>API Key</span>
                        <Input type="password" value={accountApiKey} onChange={(e) => setAccountApiKey(e.target.value)} placeholder="Paste provider API key" />
                      </label>
                      <div className="account-modal-footer">
                        <span>Account will be used for coding requests</span>
                        <button className="premium-button primary" onClick={onSaveAccount} disabled={saving || accountUsageTags.length === 0}>
                          <Icon icon="solar:diskette-bold-duotone" className="btn-icon" />
                          {saving ? "Saving..." : "Save Account"}
                        </button>
                      </div>
                    </Card.Content>
                  </Card>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
