import { memo, useState } from "react";
import { Icon } from "@iconify/react";
import type { PlaygroundModelsResult, PlaygroundTestResult } from "../../../shared/types";
import { getPlaygroundErrorSummary, normalizeOpenAiBaseUrl } from "../appState";
import { ModelPicker } from "../components/ModelPicker";

function PlaygroundPageComponent({
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
  onLoadPlaygroundModels: () => void;
  onRunPlayground: () => void;
}) {
  const [isModelsExpanded, setIsModelsExpanded] = useState(true);
  const normalizedPlaygroundBaseUrl = normalizeOpenAiBaseUrl(playgroundBaseUrl);
  const playgroundErrorSummary = getPlaygroundErrorSummary(playgroundResult);
  const runDisabled = playgroundLoading || !normalizedPlaygroundBaseUrl || !playgroundApiKey.trim() || !playgroundModel.trim() || !playgroundMessage.trim();
  const loadModelsDisabled = playgroundModelsLoading || !normalizedPlaygroundBaseUrl || !playgroundApiKey.trim();

  return (
    <section className="playground-page-container">
      {/* TOP ROW: CONFIGURATION & QUERY SIDE-BY-SIDE */}
      <div className="playground-top-row">
        {/* LEFT PANEL: PARAMETERS */}
        <article className="playground-panel-card">
          <div className="lab-title-mini">
            <Icon icon="solar:settings-bold-duotone" className="text-accent" width={20} height={20} />
            <h3>Parameters</h3>
          </div>

          <div className="premium-input-stack">
            <div className="compact-input-group">
              <label>Service URL</label>
              <input
                className="glass-input"
                value={playgroundBaseUrl}
                onChange={(e) => setPlaygroundBaseUrl(e.target.value)}
                placeholder="https://api.souimagery.fun"
              />
            </div>

            <div className="compact-input-group">
              <label>API Auth Key</label>
              <input
                type="password"
                className="glass-input"
                value={playgroundApiKey}
                onChange={(e) => setPlaygroundApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>

            <div className="compact-input-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label style={{ margin: 0 }}>Target Model</label>
                <button 
                  className="premium-button ghost sm h-8 py-0 px-3 text-[10px]"
                  onClick={onLoadPlaygroundModels}
                  disabled={loadModelsDisabled}
                >
                  <Icon icon={playgroundModelsLoading ? "solar:spinner-bold-duotone" : "solar:refresh-bold-duotone"} className={`btn-icon ${playgroundModelsLoading ? "animate-spin" : ""}`} />
                  {playgroundModelsLoading ? "Loading..." : "Load Models"}
                </button>
              </div>
              <ModelPicker
                label=""
                value={playgroundModel}
                models={models}
                query={playgroundModelQuery}
                onQueryChange={setPlaygroundModelQuery}
                onSelect={(model) => {
                  setPlaygroundModel(model);
                  setPlaygroundModelQuery(model);
                }}
              />
            </div>

            <div className="compact-input-group">
              <label>System Context</label>
              <textarea
                className="glass-input"
                rows={1}
                value={playgroundSystemPrompt}
                onChange={(e) => setPlaygroundSystemPrompt(e.target.value)}
                placeholder="System instructions..."
              />
            </div>
          </div>
        </article>

        {/* RIGHT PANEL: USER QUERY */}
        <article className="playground-panel-card">
          <div className="lab-title-mini">
            <Icon icon="solar:chat-line-bold-duotone" className="text-accent" width={20} height={20} />
            <h3>User Query</h3>
          </div>
          <textarea
            className="glass-input w-full"
            style={{ height: 'calc(100% - 140px)', minHeight: '180px' }}
            value={playgroundMessage}
            onChange={(e) => setPlaygroundMessage(e.target.value)}
            placeholder="Type your prompt here..."
          />
          <div className="button-row-spacious mt-8">
            <button className="premium-button primary flex-[2.5] justify-center" onClick={onRunPlayground} disabled={runDisabled}>
              <Icon icon={playgroundLoading ? "solar:spinner-bold-duotone" : "solar:play-bold-duotone"} className={`btn-icon ${playgroundLoading ? "animate-spin" : ""}`} />
              {playgroundLoading ? "Running..." : "Execute Test"}
            </button>
            
            <button className="premium-button ghost flex-1 justify-center" onClick={onLoadPlaygroundModels} disabled={loadModelsDisabled}>
              <Icon icon="solar:refresh-bold-duotone" className="btn-icon" />
              Models
            </button>

            <button 
              className="premium-button ghost w-14 justify-center text-red-500 border-red-500/10 hover:bg-red-500/10" 
              onClick={() => setPlaygroundResult(null)} 
              disabled={playgroundLoading || !playgroundResult}
              title="Clear Result"
            >
              <Icon icon="solar:trash-bin-trash-bold-duotone" width={20} height={20} />
            </button>
          </div>
        </article>
      </div>

      {/* BOTTOM AREA: FULL WIDTH OUTPUT */}
      <main className="output-lab-panel">
        <header className="output-lab-header">
          <div className="title">
            <Icon icon="solar:ghost-bold-duotone" />
            <span>INTELLIGENCE OUTPUT</span>
          </div>
          {playgroundResult && (
            <div className={`lab-status-badge ${playgroundResult.ok ? "success" : "error"}`}>
              {playgroundResult.status} {playgroundResult.ok ? "OK" : "ERR"}
            </div>
          )}
        </header>

        <div className="lab-main-display">
          {playgroundResult ? (
            <div className="response-scroll-area">
              {playgroundErrorSummary && (
                <div className="p-4 mb-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
                  [SYSTEM_ERROR]: {playgroundErrorSummary}
                </div>
              )}

              <div className="ai-bubble-new">
                {playgroundResult.content || "Empty response received from the model."}
              </div>

              <div className="code-inspector">
                <div className="inspector-header">
                  <span>Raw JSON Payload</span>
                  <button className="text-[9px] hover:text-white" onClick={() => navigator.clipboard.writeText(JSON.stringify(playgroundResult.raw, null, 2))}>Copy</button>
                </div>
                <div className="inspector-body">
                  <pre>{typeof playgroundResult.raw === "string" ? playgroundResult.raw : JSON.stringify(playgroundResult.raw, null, 2)}</pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-lab-state">
              <Icon icon="solar:atom-bold-duotone" width={80} height={80} className="mb-4 opacity-20" />
              <p className="text-lg font-bold tracking-tight">System Idle</p>
              <p className="text-sm mt-2">Awaiting configuration & execution parameters from the panels above.</p>
            </div>
          )}
        </div>

        {/* BOTTOM DRAWER FOR MODELS */}
        {playgroundModelsResult?.models.length ? (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '16px', background: 'rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isModelsExpanded ? '12px' : '0', padding: '0 8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Provider Models Inventory ({playgroundModelsResult.models.length} models)
              </span>
              <button 
                style={{ fontSize: '10px', color: 'var(--primary)', cursor: 'pointer', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: '4px' }} 
                onClick={() => setIsModelsExpanded(!isModelsExpanded)}
              >
                {isModelsExpanded ? "Hide" : "Show"}
                <Icon icon={isModelsExpanded ? "solar:alt-arrow-up-bold-duotone" : "solar:alt-arrow-down-bold-duotone"} />
              </button>
            </div>
            {isModelsExpanded && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {playgroundModelsResult.models.slice(0, 20).map(m => (
                  <span 
                    key={m} 
                    style={{ 
                      padding: '4px 8px', 
                      borderRadius: '4px', 
                      background: 'rgba(255,255,255,0.05)', 
                      fontSize: '10px', 
                      border: '1px solid rgba(255,255,255,0.05)', 
                      color: 'var(--muted)' 
                    }}
                  >
                    {m}
                  </span>
                ))}
                {playgroundModelsResult.models.length > 20 && (
                  <span style={{ fontSize: '10px', color: 'var(--muted)', alignSelf: 'center' }}>
                    +{playgroundModelsResult.models.length - 20} more
                  </span>
                )}
              </div>
            )}
          </div>
        ) : null}
      </main>
    </section>
  );
}

export const PlaygroundPage = memo(PlaygroundPageComponent, (prev, next) => {
  return prev.models === next.models
    && prev.playgroundModelQuery === next.playgroundModelQuery
    && prev.playgroundBaseUrl === next.playgroundBaseUrl
    && prev.playgroundApiKey === next.playgroundApiKey
    && prev.playgroundModel === next.playgroundModel
    && prev.playgroundSystemPrompt === next.playgroundSystemPrompt
    && prev.playgroundMessage === next.playgroundMessage
    && prev.playgroundModelsResult === next.playgroundModelsResult
    && prev.playgroundModelsLoading === next.playgroundModelsLoading
    && prev.playgroundResult === next.playgroundResult
    && prev.playgroundLoading === next.playgroundLoading;
});
