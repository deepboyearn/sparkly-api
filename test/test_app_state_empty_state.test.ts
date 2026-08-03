import { describe, it, expect } from "vitest";
import { emptyState } from "../src/renderer/src/appState";

describe("emptyState", () => {
  it("has correct default config", () => {
    expect(emptyState.config.upstreamBaseUrl).toBe("https://cn.chrouter.com:8443");
    expect(emptyState.config.apiKey).toBe("");
    expect(emptyState.config.models).toEqual([]);
    expect(emptyState.config.selectedModel).toBe("gpt-5.4");
    expect(emptyState.config.localPort).toBe(48231);
    expect(emptyState.config.enableCors).toBe(true);
    expect(emptyState.config.systemPrompt).toBe("");
    expect(emptyState.config.accounts).toEqual([]);
    expect(emptyState.config.activeAccountId).toBe("");
  });

  it("has correct default stats", () => {
    expect(emptyState.stats.totalRequests).toBe(0);
    expect(emptyState.stats.successCount).toBe(0);
    expect(emptyState.stats.errorCount).toBe(0);
    expect(emptyState.stats.lastRequestAt).toBeNull();
    expect(emptyState.stats.uptimeMs).toBe(0);
    expect(emptyState.stats.activeModelCount).toBe(0);
    expect(emptyState.stats.localBaseUrl).toBe("http://localhost:48231");
    expect(emptyState.stats.serverRunning).toBe(false);
  });

  it("has empty logs and clientKeys", () => {
    expect(emptyState.logs).toEqual([]);
    expect(emptyState.clientKeys).toEqual([]);
  });

  it("localBaseUrl matches localPort", () => {
    expect(emptyState.stats.localBaseUrl).toContain(
      String(emptyState.config.localPort)
    );
  });

  it("is a valid BridgeState shape", () => {
    const state = emptyState;
    expect(typeof state.config).toBe("object");
    expect(typeof state.stats).toBe("object");
    expect(Array.isArray(state.logs)).toBe(true);
    expect(Array.isArray(state.clientKeys)).toBe(true);
  });
});
