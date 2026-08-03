import { describe, it, expect } from "vitest";
import { groupModelStats } from "../src/renderer/src/appState";
import type { RequestLogEntry } from "../src/shared/types";

function makeLog(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: "log-1",
    timestamp: "2025-01-01T00:00:00Z",
    method: "POST",
    path: "/chat/completions",
    status: 200,
    durationMs: 100,
    model: "gpt-4",
    ...overrides,
  };
}

describe("groupModelStats", () => {
  it("returns empty array for empty logs", () => {
    expect(groupModelStats([])).toEqual([]);
  });

  it("groups single model correctly", () => {
    const logs = [makeLog(), makeLog({ id: "log-2" })];
    const stats = groupModelStats(logs);
    expect(stats).toHaveLength(1);
    expect(stats[0].model).toBe("gpt-4");
    expect(stats[0].requests).toBe(2);
  });

  it("groups multiple models separately", () => {
    const logs = [
      makeLog({ model: "gpt-4" }),
      makeLog({ id: "log-2", model: "gpt-4" }),
      makeLog({ id: "log-3", model: "claude-3" }),
    ];
    const stats = groupModelStats(logs);
    expect(stats).toHaveLength(2);
    const gpt = stats.find((s) => s.model === "gpt-4");
    const claude = stats.find((s) => s.model === "claude-3");
    expect(gpt?.requests).toBe(2);
    expect(claude?.requests).toBe(1);
  });

  it("uses 'unknown' for entries without model", () => {
    const logs = [makeLog({ model: undefined })];
    const stats = groupModelStats(logs);
    expect(stats).toHaveLength(1);
    expect(stats[0].model).toBe("unknown");
  });

  it("computes tokens as max(60, durationMs * 3)", () => {
    const logs = [makeLog({ durationMs: 200 })];
    const stats = groupModelStats(logs);
    expect(stats[0].tokens).toBe(600); // 200 * 3
  });

  it("enforces minimum tokens of 60", () => {
    const logs = [makeLog({ durationMs: 5 })];
    const stats = groupModelStats(logs);
    expect(stats[0].tokens).toBe(60);
  });

  it("computes cost as max(0.001, durationMs / 100000)", () => {
    const logs = [makeLog({ durationMs: 5000 })];
    const stats = groupModelStats(logs);
    expect(stats[0].cost).toBeCloseTo(0.05); // 5000 / 100000
  });

  it("enforces minimum cost of 0.001", () => {
    const logs = [makeLog({ durationMs: 1 })];
    const stats = groupModelStats(logs);
    expect(stats[0].cost).toBeCloseTo(0.001);
  });

  it("each entry has model, requests, tokens, cost", () => {
    const stats = groupModelStats([makeLog()]);
    const entry = stats[0];
    expect(entry).toHaveProperty("model");
    expect(entry).toHaveProperty("requests");
    expect(entry).toHaveProperty("tokens");
    expect(entry).toHaveProperty("cost");
  });
});
