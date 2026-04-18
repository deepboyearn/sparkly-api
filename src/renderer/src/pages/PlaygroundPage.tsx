import { memo } from "react";
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
  setPlaygroundModelsResult,
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
  setPlaygroundModelsResult: (value: PlaygroundModelsResult | null) => void;
  playgroundLoading: boolean;
  onLoadPlaygroundModels: () => void;
  onRunPlayground: () => void;
}) {
  const normalizedPlaygroundBaseUrl = normalizeOpenAiBaseUrl(playgroundBaseUrl);
  const playgroundErrorSummary = getPlaygroundErrorSummary(playgroundResult);
  const runDisabled = playgroundLoading || !normalizedPlaygroundBaseUrl || !playgroundApiKey.trim() || !playgroundModel.trim() || !playgroundMessage.trim();
  const loadModelsDisabled = playgroundModelsLoading || !normalizedPlaygroundBaseUrl || !playgroundApiKey.trim();
  const modelsStatus = playgroundModelsResult
    ? playgroundModelsResult.ok
      ? `${playgroundModelsResult.status} Loaded ${playgroundModelsResult.models.length} models`
      : `${playgroundModelsResult.status} ${playgroundModelsResult.error || "Model loading failed"}`
    : "Not loaded yet";

  return (
    <section className="api-keys-grid lower-grid">
      <article className="admin-panel settings-panel">
        <div className="section-heading">
          <h3>Prompt test</h3>
          <div className="actions-row">
            <span className="panel-tag">Live request</span>
            <button className="secondary-button" onClick={onLoadPlaygroundModels} disabled={loadModelsDisabled}>
              {playgroundModelsLoading ? "Loading models..." : "Load models"}
            </button>
            <button className="primary-button" onClick={onRunPlayground} disabled={runDisabled}>
              {playgroundLoading ? "Running..." : "Run test"}
            </button>
          </div>
        </div>
        <div className="form-grid dark-form-grid">
          <label>
            <span>Base URL</span>
            <input value={playgroundBaseUrl} onChange={(event) => setPlaygroundBaseUrl(event.target.value)} placeholder="https://api.openai.com" />
          </label>
          <label>
            <span>API key</span>
            <input type="password" value={playgroundApiKey} onChange={(event) => setPlaygroundApiKey(event.target.value)} placeholder="sk-..." />
          </label>
          <label>
            <span>Custom model</span>
            <input
              value={playgroundModel}
              onChange={(event) => {
                setPlaygroundModel(event.target.value);
                setPlaygroundModelQuery(event.target.value);
              }}
              placeholder="gpt-5.4"
            />
          </label>
          <ModelPicker
            label="Model"
            value={playgroundModel}
            models={models}
            query={playgroundModelQuery}
            onQueryChange={setPlaygroundModelQuery}
            onSelect={(model) => {
              setPlaygroundModel(model);
              setPlaygroundModelQuery(model);
            }}
          />
          <label className="full-width">
            <span>System prompt</span>
            <textarea rows={3} value={playgroundSystemPrompt} onChange={(event) => setPlaygroundSystemPrompt(event.target.value)} placeholder="Optional system prompt" />
          </label>
          <label className="full-width">
            <span>Message</span>
            <textarea rows={8} value={playgroundMessage} onChange={(event) => setPlaygroundMessage(event.target.value)} placeholder="Type your test message" />
          </label>
        </div>
        <div className="actions-row">
          <button className="secondary-button" onClick={onLoadPlaygroundModels} disabled={loadModelsDisabled}>
            {playgroundModelsLoading ? "Loading models..." : "Load models"}
          </button>
          <button className="primary-button" onClick={onRunPlayground} disabled={runDisabled}>
            {playgroundLoading ? "Running..." : "Run test"}
          </button>
          <button className="secondary-button" onClick={() => setPlaygroundResult(null)} disabled={playgroundLoading || !playgroundResult}>
            Clear result
          </button>
        </div>
      </article>

      <article className="stack-column">
        <div className="admin-panel compact-panel">
          <div className="section-heading">
            <h3>Quick values</h3>
            <button className="ghost-button" onClick={() => navigator.clipboard.writeText(playgroundBaseUrl)}>Copy URL</button>
          </div>
          <div className="detail-list">
            <div><span>Selected model</span><strong>{playgroundModel || "No model selected"}</strong></div>
            <div><span>Request target</span><strong>{normalizedPlaygroundBaseUrl || "No base URL"}</strong></div>
            <div><span>Endpoint</span><strong>/v1/chat/completions</strong></div>
            <div><span>Models</span><strong>{modelsStatus}</strong></div>
            <div><span>Status</span><strong>{playgroundResult ? `${playgroundResult.status}` : "Not tested yet"}</strong></div>
          </div>
        </div>

        <div className="admin-panel compact-panel accent-panel playground-response-panel">
          <div className="section-heading">
            <h3>Response</h3>
            <button className="ghost-button" onClick={() => setPlaygroundResult(null)}>Clear</button>
          </div>
          {playgroundResult ? <>
            {playgroundErrorSummary ? <div className="playground-status-banner error">{playgroundErrorSummary}</div> : <div className="playground-status-banner success">{`${playgroundResult.status} Success`}</div>}
            <div className="detail-list">
              <div><span>Model</span><strong>{playgroundResult.model}</strong></div>
              <div><span>Result</span><strong>{playgroundResult.ok ? "Success" : "Failed"}</strong></div>
            </div>
            <div className="playground-summary-block">
              <span>Summary</span>
              <strong>{playgroundResult.content || "No response content"}</strong>
            </div>
            <pre className="curl-block playground-output">{typeof playgroundResult.raw === "string" ? playgroundResult.raw : JSON.stringify(playgroundResult.raw, null, 2)}</pre>
          </> : <div className="empty-logs dark-empty">Run test karne ke baad yahan reply dikh jayega.</div>}
        </div>

        <div className="admin-panel compact-panel">
          <div className="section-heading">
            <h3>Loaded models</h3>
            <button className="ghost-button" onClick={() => setPlaygroundModelsResult(null)} disabled={!playgroundModelsResult}>
              Clear
            </button>
          </div>
          {playgroundModelsResult?.models.length
            ? <pre className="curl-block playground-output">{playgroundModelsResult.models.join("\n")}</pre>
            : <div className="empty-logs dark-empty">Load models karne ke baad provider ki model list yahan dikhegi.</div>}
        </div>
      </article>
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
