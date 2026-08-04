import { memo, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import type {
  AccountProvider,
  PlaygroundModelsResult,
  PlaygroundResponseFormat,
  PlaygroundTestInput,
  PlaygroundTestResult,
  PlaygroundThinkingMode,
  UpstreamAccount,
} from "../../../shared/types";
import { getPlaygroundErrorSummary } from "../appState";
import { AccountPicker } from "../components/AccountPicker";
import { ModelPicker } from "../components/ModelPicker";
import { Select } from "../components/ui";

type RunnableProtocol = Exclude<AccountProvider, "auto" | "v0">;
type ReasoningEffort = NonNullable<PlaygroundTestInput["reasoningEffort"]>;

const protocolOptions: Array<{ value: RunnableProtocol; label: string; description: string }> = [
  { value: "openai-compatible", label: "OpenAI compatible", description: "Chat Completions and compatible gateways" },
  { value: "anthropic", label: "Anthropic Messages", description: "Native Claude Messages API" },
  { value: "gemini", label: "Google Gemini", description: "Native generateContent API" },
  { value: "ollama", label: "Ollama", description: "Local Ollama chat API" },
  { value: "cohere", label: "Cohere v2", description: "Native Cohere Chat API" },
];

const thinkingOptions: Array<{ value: PlaygroundThinkingMode; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Omit the parameter" },
  { value: "disabled", label: "Disabled", description: "No extended thinking" },
  { value: "adaptive", label: "Adaptive", description: "Newer Claude models" },
  { value: "enabled", label: "Manual budget", description: "Claude 4.5 and earlier" },
];

const reasoningOptions: Array<{ value: ReasoningEffort | ""; label: string }> = [
  { value: "", label: "Provider default" },
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Maximum" },
];

const responseFormatOptions: Array<{ value: PlaygroundResponseFormat; label: string }> = [
  { value: "text", label: "Text" },
  { value: "json_object", label: "JSON object" },
];

function modelDisplayName(model: string): string {
  const segments = model.split("/").filter(Boolean);
  return segments.at(-1) || model;
}

function runnableProtocol(account?: UpstreamAccount): RunnableProtocol {
  const candidate = account?.detectedProtocol ?? account?.provider;
  return candidate && candidate !== "auto" && candidate !== "v0" ? candidate : "openai-compatible";
}

function parseAdvancedJson(value: string): { value: Record<string, unknown>; error: string | null } {
  if (!value.trim()) return { value: {}, error: null };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return { value: {}, error: "Advanced JSON must be an object." };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch (error) {
    return { value: {}, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

function PlaygroundPageComponent({
  accounts,
  models,
  playgroundModelQuery,
  setPlaygroundModelQuery,
  playgroundBaseUrl,
  setPlaygroundBaseUrl,
  playgroundApiKey,
  setPlaygroundApiKey,
  playgroundModel,
  setPlaygroundModel,
  playgroundSystemPrompt,
  setPlaygroundSystemPrompt,
  playgroundMessage,
  setPlaygroundMessage,
  playgroundModelsResult,
  playgroundModelsLoading,
  playgroundResult,
  setPlaygroundResult,
  playgroundLoading,
  onLoadPlaygroundModels,
  onRunPlayground,
}: {
  accounts?: UpstreamAccount[];
  models: string[];
  playgroundModelQuery: string;
  setPlaygroundModelQuery: (value: string) => void;
  playgroundBaseUrl: string;
  setPlaygroundBaseUrl: (value: string) => void;
  playgroundApiKey: string;
  setPlaygroundApiKey: (value: string) => void;
  playgroundModel: string;
  setPlaygroundModel: (value: string) => void;
  playgroundSystemPrompt: string;
  setPlaygroundSystemPrompt: (value: string) => void;
  playgroundMessage: string;
  setPlaygroundMessage: (value: string) => void;
  playgroundModelsResult: PlaygroundModelsResult | null;
  playgroundModelsLoading: boolean;
  playgroundResult: PlaygroundTestResult | null;
  setPlaygroundResult: (value: PlaygroundTestResult | null) => void;
  playgroundLoading: boolean;
  onLoadPlaygroundModels: (protocol: RunnableProtocol) => void;
  onRunPlayground: (input: PlaygroundTestInput) => void;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [protocol, setProtocol] = useState<RunnableProtocol>("openai-compatible");
  const [maxTokens, setMaxTokens] = useState(2048);
  const [temperature, setTemperature] = useState("0.7");
  const [topP, setTopP] = useState("");
  const [seed, setSeed] = useState("");
  const [stopSequences, setStopSequences] = useState("");
  const [thinkingMode, setThinkingMode] = useState<PlaygroundThinkingMode>("auto");
  const [thinkingBudget, setThinkingBudget] = useState(1024);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | "">("");
  const [responseFormat, setResponseFormat] = useState<PlaygroundResponseFormat>("text");
  const [advancedJson, setAdvancedJson] = useState("{}");
  const [showConnection, setShowConnection] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isModelsExpanded, setIsModelsExpanded] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!accounts?.length || accounts.some((account) => account.id === selectedAccountId)) return;
    const active = accounts.find((account) => account.isActive) ?? accounts[0];
    const initialModel = playgroundModel || active.selectedModel || active.models[0] || "";
    setSelectedAccountId(active.id);
    setProtocol(runnableProtocol(active));
    setPlaygroundBaseUrl(active.baseUrl);
    setPlaygroundApiKey(active.apiKey);
    setPlaygroundModel(initialModel);
    setPlaygroundModelQuery(initialModel);
  }, [accounts, playgroundModel, selectedAccountId, setPlaygroundApiKey, setPlaygroundBaseUrl, setPlaygroundModel, setPlaygroundModelQuery]);

  const selectedAccount = accounts?.find((account) => account.id === selectedAccountId);
  const availableModels = selectedAccount?.models.length ? selectedAccount.models : models;
  const advanced = useMemo(() => parseAdvancedJson(advancedJson), [advancedJson]);
  const playgroundErrorSummary = getPlaygroundErrorSummary(playgroundResult);
  const keyRequired = protocol !== "ollama";
  const baseReady = Boolean(playgroundBaseUrl.trim());
  const credentialsReady = !keyRequired || Boolean(playgroundApiKey.trim());
  const runDisabled = playgroundLoading || !baseReady || !credentialsReady || !playgroundModel.trim() || !playgroundMessage.trim();
  const loadModelsDisabled = playgroundModelsLoading || !baseReady || !credentialsReady;

  function handleSelectAccount(accountId: string) {
    setSelectedAccountId(accountId);
    const account = accounts?.find((candidate) => candidate.id === accountId);
    if (!account) return;
    const nextModel = account.selectedModel || account.models[0] || "";
    setProtocol(runnableProtocol(account));
    setPlaygroundBaseUrl(account.baseUrl);
    setPlaygroundApiKey(account.apiKey);
    setPlaygroundModel(nextModel);
    setPlaygroundModelQuery(nextModel);
    setPlaygroundResult(null);
  }

  function execute() {
    setValidationError(null);
    if (advanced.error) {
      setValidationError(`Advanced JSON: ${advanced.error}`);
      return;
    }
    if (maxTokens < 1 || maxTokens > 1_000_000) {
      setValidationError("Max output tokens must be between 1 and 1,000,000.");
      return;
    }
    if (thinkingMode === "enabled" && (thinkingBudget < 1024 || thinkingBudget >= maxTokens)) {
      setValidationError("Manual thinking requires at least 1,024 tokens and must stay below max output tokens.");
      return;
    }
    const parsedTemperature = temperature.trim() ? Number(temperature) : undefined;
    const parsedTopP = topP.trim() ? Number(topP) : undefined;
    const parsedSeed = seed.trim() ? Number(seed) : undefined;
    if (parsedTemperature !== undefined && (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2)) {
      setValidationError("Temperature must be between 0 and 2.");
      return;
    }
    if (parsedTopP !== undefined && (!Number.isFinite(parsedTopP) || parsedTopP <= 0 || parsedTopP > 1)) {
      setValidationError("Top P must be greater than 0 and at most 1.");
      return;
    }
    if (parsedSeed !== undefined && !Number.isSafeInteger(parsedSeed)) {
      setValidationError("Seed must be a safe integer.");
      return;
    }

    onRunPlayground({
      baseUrl: playgroundBaseUrl.trim().replace(/\/+$/, ""),
      apiKey: playgroundApiKey.trim(),
      protocol,
      model: playgroundModel.trim(),
      message: playgroundMessage,
      systemPrompt: playgroundSystemPrompt.trim() || undefined,
      maxTokens,
      temperature: parsedTemperature,
      topP: parsedTopP,
      seed: parsedSeed,
      stopSequences: stopSequences.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
      reasoningEffort: reasoningEffort || undefined,
      thinkingMode,
      thinkingBudget: thinkingMode === "enabled" ? thinkingBudget : undefined,
      responseFormat,
      advancedBody: advanced.value,
    });
  }

  return (
    <section className="playground-page-container playground-studio">
      <header className="playground-studio-toolbar">
        <div className="playground-toolbar-field account-field">
          <span>Account</span>
          <AccountPicker accounts={accounts || []} selectedAccountId={selectedAccountId} onSelectAccount={handleSelectAccount} />
        </div>
        <div className="playground-toolbar-field protocol-field">
          <span>Protocol</span>
          <Select options={protocolOptions} value={protocol} onChange={setProtocol} />
        </div>
        <div className="playground-toolbar-field model-field">
          <div className="playground-toolbar-label">
            <span>Model</span>
            <small>{availableModels.length.toLocaleString()} available</small>
          </div>
          <ModelPicker
            popover
            label=""
            value={playgroundModel}
            models={availableModels}
            query={playgroundModelQuery}
            onQueryChange={setPlaygroundModelQuery}
            onSelect={(model) => {
              setPlaygroundModel(model);
              setPlaygroundModelQuery(model);
            }}
          />
        </div>
        <div className="playground-toolbar-actions">
          <button type="button" className="playground-icon-action" onClick={() => onLoadPlaygroundModels(protocol)} disabled={loadModelsDisabled} title="Discover models" aria-label="Discover models">
            <Icon icon="solar:refresh-bold-duotone" className={playgroundModelsLoading ? "animate-spin" : ""} />
          </button>
          <button type="button" className={`playground-toolbar-button ${showConnection ? "active" : ""}`} onClick={() => setShowConnection((current) => !current)} aria-expanded={showConnection}>
            <Icon icon="solar:server-square-cloud-bold-duotone" /> Connection
          </button>
          <button type="button" className={`playground-toolbar-button ${showSettings ? "active" : ""}`} onClick={() => setShowSettings((current) => !current)} aria-expanded={showSettings}>
            <Icon icon="solar:tuning-square-2-bold-duotone" /> Settings
          </button>
        </div>
      </header>

      {showConnection ? (
        <div className="playground-compact-drawer connection-drawer">
          <label><span>Exact API base URL</span><input className="glass-input" value={playgroundBaseUrl} onChange={(event) => setPlaygroundBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></label>
          <label><span>API key {keyRequired ? "" : "(optional)"}</span><input className="glass-input" type="password" value={playgroundApiKey} onChange={(event) => setPlaygroundApiKey(event.target.value)} placeholder={keyRequired ? "Provider API key" : "Optional for Ollama"} /></label>
        </div>
      ) : null}

      {showSettings ? (
        <div className="playground-compact-drawer settings-drawer">
          <label><span>Max tokens</span><input className="glass-input" type="number" min={1} max={1_000_000} value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} /></label>
          <label><span>Temperature</span><input className="glass-input" inputMode="decimal" value={temperature} onChange={(event) => setTemperature(event.target.value)} placeholder="Default" /></label>
          <div><span>Format</span><Select options={responseFormatOptions} value={responseFormat} onChange={setResponseFormat} /></div>
          <label><span>Top P</span><input className="glass-input" inputMode="decimal" value={topP} onChange={(event) => setTopP(event.target.value)} placeholder="Default" /></label>
          <label><span>Seed</span><input className="glass-input" inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="Optional" /></label>
          <div><span>Thinking</span><Select options={thinkingOptions} value={thinkingMode} onChange={setThinkingMode} /></div>
          <div>
            <span>{thinkingMode === "enabled" ? "Thinking budget" : "Reasoning"}</span>
            {thinkingMode === "enabled" ? <input className="glass-input" type="number" min={1024} value={thinkingBudget} onChange={(event) => setThinkingBudget(Number(event.target.value))} /> : <Select options={reasoningOptions} value={reasoningEffort} onChange={setReasoningEffort} />}
          </div>
          <label className="stop-field"><span>Stop sequences</span><input className="glass-input" value={stopSequences} onChange={(event) => setStopSequences(event.target.value)} placeholder="Comma or newline separated" /></label>
          <button type="button" className={`playground-toolbar-button advanced-button ${showAdvanced ? "active" : ""}`} onClick={() => setShowAdvanced((current) => !current)} aria-expanded={showAdvanced}>
            <Icon icon="solar:code-square-bold-duotone" /> Advanced JSON
          </button>
          {showAdvanced ? (
            <label className="advanced-json-field">
              <span>Request body overrides</span>
              <textarea className={`glass-input playground-json-editor ${advanced.error ? "invalid" : ""}`} rows={7} value={advancedJson} onChange={(event) => setAdvancedJson(event.target.value)} spellCheck={false} />
              {advanced.error ? <small className="playground-validation-error">{advanced.error}</small> : null}
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="playground-studio-grid">
        <article className="playground-studio-pane prompt-pane">
          <header className="playground-pane-header">
            <div><Icon icon="solar:pen-new-square-bold-duotone" /><strong>Prompt</strong></div>
            <button type="button" className={`playground-pane-action ${showSystemPrompt ? "active" : ""}`} onClick={() => setShowSystemPrompt((current) => !current)}>
              <Icon icon="solar:shield-user-bold-duotone" /> System {playgroundSystemPrompt.trim() ? "set" : "prompt"}
            </button>
          </header>
          {showSystemPrompt ? (
            <textarea className="playground-system-editor" rows={4} value={playgroundSystemPrompt} onChange={(event) => setPlaygroundSystemPrompt(event.target.value)} placeholder="Optional system or developer instructions..." />
          ) : null}
          <textarea
            className="playground-main-editor"
            value={playgroundMessage}
            onChange={(event) => setPlaygroundMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !runDisabled) {
                event.preventDefault();
                execute();
              }
            }}
            placeholder="Type a prompt, paste content, or test an instruction..."
          />
          {validationError ? <div className="playground-validation-error studio-error" role="alert">{validationError}</div> : null}
          <footer className="playground-prompt-footer">
            <span><Icon icon="solar:shield-check-bold-duotone" /> No hidden context or request replay</span>
            <div>
              <small>Ctrl + Enter</small>
              <button type="button" className="premium-button primary playground-run-button" onClick={execute} disabled={runDisabled}>
                <Icon icon={playgroundLoading ? "solar:refresh-bold-duotone" : "solar:play-bold-duotone"} className={playgroundLoading ? "animate-spin" : ""} />
                {playgroundLoading ? "Running..." : "Run"}
              </button>
            </div>
          </footer>
        </article>

        <article className="playground-studio-pane response-pane">
          <header className="playground-pane-header">
            <div><Icon icon="solar:stars-minimalistic-bold-duotone" /><strong>Response</strong></div>
            <div className="playground-response-actions">
              {playgroundResult ? <span className={`lab-status-badge ${playgroundResult.ok ? "success" : "error"}`}>{playgroundResult.status}</span> : null}
              <button type="button" className="playground-pane-action" onClick={() => setPlaygroundResult(null)} disabled={playgroundLoading || !playgroundResult}><Icon icon="solar:trash-bin-trash-bold-duotone" /> Clear</button>
            </div>
          </header>
          <div className="playground-response-body">
            {playgroundResult ? (
              <>
                {playgroundErrorSummary ? <div className="playground-provider-error" role="alert"><strong>Provider rejected the request</strong><span>{playgroundErrorSummary}</span>{/clear_thinking/i.test(playgroundErrorSummary) ? <small>Use Adaptive or Disabled thinking. The rejected strategy came from the upstream gateway or model policy.</small> : null}</div> : null}
                {playgroundResult.content || playgroundResult.ok ? (
                  <div className="playground-response-copy">{playgroundResult.content || "Empty response received."}</div>
                ) : null}
                {playgroundResult.resolvedUrl ? <div className="playground-resolved-url">Endpoint: <code>{playgroundResult.resolvedUrl}</code></div> : null}
                <div className="playground-inspector-row">
                  <details className="playground-inspector-detail">
                    <summary>Normalized request</summary>
                    <div className="inspector-header"><span>Request JSON</span><button type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(playgroundResult.request, null, 2))}>Copy</button></div>
                    <pre>{JSON.stringify(playgroundResult.request, null, 2)}</pre>
                  </details>
                  <details className="playground-inspector-detail">
                    <summary>Raw provider response</summary>
                    <div className="inspector-header"><span>Raw response</span><button type="button" onClick={() => void navigator.clipboard.writeText(JSON.stringify(playgroundResult.raw, null, 2))}>Copy</button></div>
                    <pre>{typeof playgroundResult.raw === "string" ? playgroundResult.raw : JSON.stringify(playgroundResult.raw, null, 2)}</pre>
                  </details>
                </div>
              </>
            ) : (
              <div className="playground-response-empty">
                <Icon icon="solar:chat-round-dots-bold-duotone" />
                <strong>Response appears here</strong>
                <span>Run the prompt to inspect model output, normalized request, and raw provider data.</span>
              </div>
            )}
          </div>
        </article>
      </div>

      {playgroundModelsResult?.models.length ? (
        <div className="playground-model-inventory compact-inventory">
          <button type="button" className="playground-inventory-heading" onClick={() => setIsModelsExpanded((current) => !current)}>
            <span>Last discovery: {playgroundModelsResult.models.length.toLocaleString()} models</span>
            <Icon icon={isModelsExpanded ? "solar:alt-arrow-up-bold-duotone" : "solar:alt-arrow-down-bold-duotone"} />
          </button>
          {isModelsExpanded ? <div className="playground-inventory-list">{playgroundModelsResult.models.slice(0, 100).map((model) => <span className="playground-model-chip" key={model}><strong>{modelDisplayName(model)}</strong><small>{model}</small></span>)}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

export const PlaygroundPage = memo(PlaygroundPageComponent);
export default PlaygroundPage;
