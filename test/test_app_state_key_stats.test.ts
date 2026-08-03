import { describe, it, expect } from "vitest";
import { groupKeyStats } from "../src/renderer/src/appState";
import type { BridgeState } from "../src/shared/types";

const mockKeys: BridgeState["clientKeys"] = [
  {
    id: "key-1",
    name: "Dev Key",
    key: "sk-abc123",
    maskedKey: "sk-a...123",
    createdAt: "2025-01-01T00:00:00Z",
    lastUsedAt: null,
    isActive: true,
  },
  {
    id: "key-2",
    name: "Prod Key",
    key: "sk-def456",
    maskedKey: "sk-d...456",
    createdAt: "2025-02-01T00:00:00Z",
    lastUsedAt: null,
    isActive: true,
  },
];

const mockLogs: BridgeState["logs"] = [
  {
    id: "log-1",
    timestamp: "2025-01-01T00:00:00Z",
    method: "POST",
    path: "/chat/completions",
    status: 200,
    durationMs: 100,
  },
  {
    id: "log-2",
    timestamp: "2025-01-01T01:00:00Z",
    method: "POST",
    path: "/chat/completions",
    status: 200,
    durationMs: 200,
  },
];

describe("groupKeyStats", () => {
  it("returns empty array when no client keys", () => {
    expect(groupKeyStats(mockLogs, [])).toEqual([]);
  });

  it("returns one entry per client key", () => {
    const stats = groupKeyStats(mockLogs, mockKeys);
    expect(stats).toHaveLength(2);
  });

  it("each entry has required fields", () => {
    const stats = groupKeyStats(mockLogs, mockKeys);
    for (const s of stats) {
      expect(s).toHaveProperty("id");
      expect(s).toHaveProperty("name");
      expect(s).toHaveProperty("maskedKey");
      expect(s).toHaveProperty("requests");
      expect(s).toHaveProperty("tokens");
      expect(s).toHaveProperty("cost");
    }
  });

  it("preserves key id and name", () => {
    const stats = groupKeyStats(mockLogs, mockKeys);
    expect(stats[0].id).toBe("key-1");
    expect(stats[0].name).toBe("Dev Key");
    expect(stats[1].id).toBe("key-2");
    expect(stats[1].name).toBe("Prod Key");
  });

  it("preserves maskedKey", () => {
    const stats = groupKeyStats(mockLogs, mockKeys);
    expect(stats[0].maskedKey).toBe("sk-a...123");
  });

  it("aggregates total requests from all logs", () => {
    const stats = groupKeyStats(mockLogs, mockKeys);
    // Both keys get the same aggregated stats (all logs)
    expect(stats[0].requests).toBe(2);
    expect(stats[1].requests).toBe(2);
  });

  it("computes tokens from all logs", () => {
    const stats = groupKeyStats(mockLogs, mockKeys);
    // log1: max(60, 100*3)=300, log2: max(60, 200*3)=600 → total 900
    expect(stats[0].tokens).toBe(900);
  });

  it("computes cost from all logs", () => {
    const stats = groupKeyStats(mockLogs, mockKeys);
    // log1: max(0.001, 100/100000)=0.001, log2: max(0.001, 200/100000)=0.002 → 0.003
    expect(stats[0].cost).toBeCloseTo(0.003);
  });

  it("works with empty logs", () => {
    const stats = groupKeyStats([], mockKeys);
    expect(stats).toHaveLength(2);
    expect(stats[0].requests).toBe(0);
    expect(stats[0].tokens).toBe(0);
    expect(stats[0].cost).toBe(0);
  });
});
