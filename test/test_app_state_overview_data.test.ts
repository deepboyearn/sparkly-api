import { describe, it, expect } from "vitest";
import { normalizeBridgeState } from "../src/renderer/src/appState";
import type { BridgeState } from "../src/shared/types";

// Overview page filters logs by model and displays summary stats.
// This tests the data preparation that feeds the overview page.

describe("overview data (via normalizeBridgeState)", () => {
  const mockLogs: BridgeState["logs"] = [
    {
      id: "log-1",
      timestamp: "2025-06-15T10:00:00Z",
      method: "POST",
      path: "/chat/completions",
      status: 200,
      model: "gpt-4",
      durationMs: 500,
    },
    {
      id: "log-2",
      timestamp: "2025-06-15T11:00:00Z",
      method: "POST",
      path: "/chat/completions",
      status: 500,
      model: "claude-3",
      durationMs: 200,
      error: "timeout",
    },
    {
      id: "log-3",
      timestamp: "2025-06-15T12:00:00Z",
      method: "GET",
      path: "/models",
      status: 200,
      model: "gpt-4",
      durationMs: 100,
    },
  ];

  it("normalizes state with logs intact", () => {
    const state = normalizeBridgeState({ logs: mockLogs });
    expect(state.logs).toHaveLength(3);
  });

  it("logs can be filtered by model", () => {
    const state = normalizeBridgeState({ logs: mockLogs });
    const gptLogs = state.logs.filter((l) => l.model === "gpt-4");
    expect(gptLogs).toHaveLength(2);
  });

  it("logs can be filtered by status code", () => {
    const state = normalizeBridgeState({ logs: mockLogs });
    const errors = state.logs.filter((l) => l.status >= 400);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe("timeout");
  });

  it("stats reflect server state", () => {
    const state = normalizeBridgeState({
      stats: {
        totalRequests: 150,
        successCount: 140,
        errorCount: 10,
        lastRequestAt: "2025-06-15T12:00:00Z",
        uptimeMs: 7200000,
        activeModelCount: 2,
        localBaseUrl: "http://localhost:8080",
        serverRunning: true,
      },
    });
    expect(state.stats.totalRequests).toBe(150);
    expect(state.stats.serverRunning).toBe(true);
    expect(state.stats.activeModelCount).toBe(2);
  });

  it("empty logs produce empty overview", () => {
    const state = normalizeBridgeState({ logs: [] });
    expect(state.logs).toEqual([]);
  });
});
