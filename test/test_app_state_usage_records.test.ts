import { describe, it, expect } from "vitest";
import { getUsageRecords } from "../src/renderer/src/appState";
import type { BridgeState } from "../src/shared/types";

function makeLogs(count: number): BridgeState["logs"] {
  return Array.from({ length: count }, (_, i) => ({
    id: `log-${i}`,
    timestamp: "2025-06-15T12:30:00.000Z",
    method: "POST",
    path: i % 2 === 0 ? "/v1/chat/completions" : "/v1/embeddings",
    status: i % 3 === 0 ? 500 : 200,
    model: i % 2 === 0 ? "gpt-4" : "text-embedding-3-small",
    durationMs: 100 + i * 50,
  }));
}

const mockClientKeys: BridgeState["clientKeys"] = [
  {
    id: "key-1",
    name: "Dev",
    key: "sk-abcdef123456",
    maskedKey: "sk-a...3456",
    createdAt: "2025-01-01T00:00:00Z",
    lastUsedAt: null,
    isActive: true,
  },
];

describe("getUsageRecords", () => {
  it("returns one record per log entry", () => {
    const logs = makeLogs(5);
    const records = getUsageRecords(logs, mockClientKeys, "sk-fallback");
    expect(records).toHaveLength(5);
  });

  it("each record has required fields", () => {
    const records = getUsageRecords(makeLogs(1), mockClientKeys, "sk-fb");
    const r = records[0];
    expect(r).toHaveProperty("id");
    expect(r).toHaveProperty("time");
    expect(r).toHaveProperty("model");
    expect(r).toHaveProperty("tokens");
    expect(r).toHaveProperty("tps");
    expect(r).toHaveProperty("responseTime");
    expect(r).toHaveProperty("status");
    expect(r).toHaveProperty("source");
    expect(r).toHaveProperty("ip");
    expect(r).toHaveProperty("apiKey");
    expect(r).toHaveProperty("amountSpent");
    expect(r).toHaveProperty("balanceChange");
    expect(r).toHaveProperty("requestId");
    expect(r).toHaveProperty("requestType");
  });

  it("extracts source from path", () => {
    const logs = makeLogs(2);
    const records = getUsageRecords(logs, [], "");
    expect(records[0].source).toBe("chat.completions");
    expect(records[1].source).toBe("v1/embeddings");
  });

  it("computes tokens as max(60, durationMs * 3)", () => {
    const logs = [{ ...makeLogs(1)[0], durationMs: 100 }];
    const records = getUsageRecords(logs, [], "");
    expect(records[0].tokens).toBe(300); // 100 * 3
  });

  it("enforces minimum tokens of 60", () => {
    const logs = [{ ...makeLogs(1)[0], durationMs: 10 }];
    const records = getUsageRecords(logs, [], "");
    expect(records[0].tokens).toBe(60); // max(60, 30) = 60
  });

  it("formats responseTime with ms suffix", () => {
    const logs = [{ ...makeLogs(1)[0], durationMs: 42 }];
    const records = getUsageRecords(logs, [], "");
    expect(records[0].responseTime).toBe("42 ms");
  });

  it("formats amountSpent as dollar string with 3 decimals", () => {
    const logs = [{ ...makeLogs(1)[0], durationMs: 10000 }];
    const records = getUsageRecords(logs, [], "");
    // 10000 / 100000 = 0.1
    expect(records[0].amountSpent).toBe("$0.100");
  });

  it("uses first client key maskedKey when available", () => {
    const records = getUsageRecords(makeLogs(1), mockClientKeys, "sk-fallback");
    expect(records[0].apiKey).toBe("sk-a...3456");
  });

  it("falls back to maskKey(upstreamApiKey) when no client keys", () => {
    const records = getUsageRecords(makeLogs(1), [], "sk-upstream-long-key");
    expect(records[0].apiKey).toContain("...");
  });

  it("requestId is first 8 chars of entry id", () => {
    const logs = [{ ...makeLogs(1)[0], id: "abcdef12-3456-7890" }];
    const records = getUsageRecords(logs, [], "");
    expect(records[0].requestId).toBe("abcdef12");
  });

  it("ip is always localhost", () => {
    const records = getUsageRecords(makeLogs(3), [], "");
    for (const r of records) {
      expect(r.ip).toBe("localhost");
    }
  });

  it("returns empty array for empty logs", () => {
    expect(getUsageRecords([], [], "")).toEqual([]);
  });
});
