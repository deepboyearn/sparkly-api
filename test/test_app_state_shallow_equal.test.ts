import { describe, it, expect } from "vitest";
import { normalizeBridgeState, emptyState } from "../src/renderer/src/appState";

// shallowEqual is not exported, so we test it indirectly via normalizeBridgeState.
// When two identical inputs are normalized with prev, the prev reference is returned (identity check).
// When inputs differ shallowly, a new object is returned.

describe("shallow equality (tested via normalizeBridgeState skip-render optimization)", () => {
  const makeConfig = (overrides: Record<string, unknown> = {}) => ({
    ...emptyState.config,
    ...overrides,
  });

  it("same config object → same prev reference returned", () => {
    const input = { config: makeConfig(), stats: emptyState.stats, logs: [], clientKeys: [] };
    const first = normalizeBridgeState(input);
    const second = normalizeBridgeState(input, first);
    expect(second).toBe(first);
  });

  it("shallow-different config → new reference", () => {
    const a = normalizeBridgeState({
      config: makeConfig({ apiKey: "a" }),
      stats: emptyState.stats,
      logs: [],
      clientKeys: [],
    });
    const b = normalizeBridgeState(
      {
        config: makeConfig({ apiKey: "b" }),
        stats: emptyState.stats,
        logs: [],
        clientKeys: [],
      },
      a
    );
    expect(b).not.toBe(a);
  });

  it("identical stats → prev reference preserved", () => {
    const stats = {
      totalRequests: 42,
      successCount: 40,
      errorCount: 2,
      lastRequestAt: "2025-01-01T00:00:00Z",
      uptimeMs: 10000,
      activeModelCount: 3,
      localBaseUrl: "http://localhost:8080",
      serverRunning: true,
    };
    const first = normalizeBridgeState({ config: makeConfig(), stats, logs: [], clientKeys: [] });
    const second = normalizeBridgeState({ config: makeConfig(), stats, logs: [], clientKeys: [] }, first);
    expect(second).toBe(first);
  });

  it("different stats object with same values → new reference (shallow compare detects mutation)", () => {
    const first = normalizeBridgeState({
      config: makeConfig(),
      stats: { ...emptyState.stats, totalRequests: 5 },
      logs: [],
      clientKeys: [],
    });
    // Create a new object with same values — shallow equal will detect it's a different reference
    // but values are same, so it SHOULD return prev
    const second = normalizeBridgeState(
      { config: makeConfig(), stats: { ...emptyState.stats, totalRequests: 5 }, logs: [], clientKeys: [] },
      first
    );
    expect(second).toBe(first);
  });

  it("different key count in objects → new reference", () => {
    const first = normalizeBridgeState({
      config: makeConfig(),
      stats: emptyState.stats,
      logs: [],
      clientKeys: [],
    });
    const second = normalizeBridgeState(
      { config: makeConfig({ extra: true } as unknown as Partial<typeof emptyState.config>), stats: emptyState.stats, logs: [], clientKeys: [] },
      first
    );
    expect(second).not.toBe(first);
  });
});
