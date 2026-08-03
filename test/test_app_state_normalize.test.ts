import { describe, it, expect } from "vitest";
import { normalizeBridgeState } from "../src/renderer/src/appState";

describe("normalizeBridgeState", () => {
  const makeFullState = () => ({
    config: {
      upstreamBaseUrl: "https://example.com",
      apiKey: "sk-test",
      models: ["gpt-4"],
      selectedModel: "gpt-4",
      localPort: 8080,
      enableCors: true,
      systemPrompt: "You are helpful",
      accounts: [],
      activeAccountId: "",
    },
    stats: {
      totalRequests: 100,
      successCount: 95,
      errorCount: 5,
      lastRequestAt: "2025-01-01T00:00:00Z",
      uptimeMs: 3600000,
      activeModelCount: 1,
      localBaseUrl: "http://localhost:8080",
      serverRunning: true,
    },
    logs: [
      {
        id: "log-1",
        timestamp: "2025-01-01T00:00:00Z",
        method: "POST",
        path: "/chat/completions",
        status: 200,
        model: "gpt-4",
        durationMs: 500,
      },
    ],
    clientKeys: [
      {
        id: "key-1",
        name: "Test Key",
        key: "sk-abcdef123456",
        maskedKey: "sk-a...3456",
        createdAt: "2025-01-01T00:00:00Z",
        lastUsedAt: null,
        isActive: true,
      },
    ],
  });

  it("merges partial input with emptyState defaults", () => {
    const result = normalizeBridgeState({});
    expect(result.config.upstreamBaseUrl).toBe("https://cn.chrouter.com:8443");
    expect(result.stats.totalRequests).toBe(0);
    expect(result.logs).toEqual([]);
    expect(result.clientKeys).toEqual([]);
  });

  it("uses all fields from input when provided", () => {
    const full = makeFullState();
    const result = normalizeBridgeState(full);
    expect(result.config.apiKey).toBe("sk-test");
    expect(result.stats.totalRequests).toBe(100);
    expect(result.logs).toHaveLength(1);
    expect(result.clientKeys).toHaveLength(1);
  });

  it("returns prev reference when data is identical (skip re-render optimization)", () => {
    const full = makeFullState();
    const prev = normalizeBridgeState(full);
    const next = normalizeBridgeState(full, prev);
    expect(next).toBe(prev);
  });

  it("returns new reference when config changes", () => {
    const full = makeFullState();
    const prev = normalizeBridgeState(full);
    const changed = { ...full, config: { ...full.config, apiKey: "sk-new" } };
    const next = normalizeBridgeState(changed, prev);
    expect(next).not.toBe(prev);
    expect(next.config.apiKey).toBe("sk-new");
  });

  it("returns new reference when logs differ in length", () => {
    const full = makeFullState();
    const prev = normalizeBridgeState(full);
    const changed = {
      ...full,
      logs: [
        ...full.logs,
        {
          id: "log-2",
          timestamp: "2025-01-01T01:00:00Z",
          method: "POST",
          path: "/chat/completions",
          status: 200,
          durationMs: 200,
        },
      ],
    };
    const next = normalizeBridgeState(changed, prev);
    expect(next).not.toBe(prev);
    expect(next.logs).toHaveLength(2);
  });

  it("returns new reference when first log id changes", () => {
    const full = makeFullState();
    const prev = normalizeBridgeState(full);
    const changed = {
      ...full,
      logs: [
        {
          id: "log-new",
          timestamp: "2025-01-01T00:00:00Z",
          method: "POST",
          path: "/chat/completions",
          status: 200,
          durationMs: 500,
        },
      ],
    };
    const next = normalizeBridgeState(changed, prev);
    expect(next).not.toBe(prev);
  });

  it("returns new reference when clientKeys differ", () => {
    const full = makeFullState();
    const prev = normalizeBridgeState(full);
    const changed = {
      ...full,
      clientKeys: [
        {
          id: "key-2",
          name: "New Key",
          key: "sk-new",
          maskedKey: "sk-n...new",
          createdAt: "2025-01-02T00:00:00Z",
          lastUsedAt: null,
          isActive: true,
        },
      ],
    };
    const next = normalizeBridgeState(changed, prev);
    expect(next).not.toBe(prev);
  });

  it("returns new reference when stats change", () => {
    const full = makeFullState();
    const prev = normalizeBridgeState(full);
    const changed = {
      ...full,
      stats: { ...full.stats, totalRequests: 200 },
    };
    const next = normalizeBridgeState(changed, prev);
    expect(next).not.toBe(prev);
    expect(next.stats.totalRequests).toBe(200);
  });

  it("handles undefined logs gracefully", () => {
    const result = normalizeBridgeState({ config: undefined, stats: undefined });
    expect(result.logs).toEqual([]);
    expect(result.clientKeys).toEqual([]);
  });

  it("defensive-copies logs array", () => {
    const full = makeFullState();
    const result = normalizeBridgeState(full);
    result.logs.push({
      id: "extra",
      timestamp: "2025-01-01T02:00:00Z",
      method: "GET",
      path: "/",
      status: 200,
      durationMs: 10,
    });
    const result2 = normalizeBridgeState(full);
    expect(result2.logs).toHaveLength(1);
  });
});
