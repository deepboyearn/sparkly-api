import { describe, it, expect } from "vitest";
import { getRequestPoints } from "../src/renderer/src/appState";
import type { RequestLogEntry } from "../src/shared/types";

function makeLog(hoursAgo: number, overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  const d = new Date(Date.now() - hoursAgo * 3600000);
  return {
    id: `log-${hoursAgo}`,
    timestamp: d.toISOString(),
    method: "POST",
    path: "/chat/completions",
    status: 200,
    durationMs: 500,
    ...overrides,
  };
}

describe("getRequestPoints", () => {
  it("returns 12 points", () => {
    const points = getRequestPoints([]);
    expect(points).toHaveLength(12);
  });

  it("each point has label and value", () => {
    const points = getRequestPoints([]);
    for (const p of points) {
      expect(typeof p.label).toBe("string");
      expect(typeof p.value).toBe("number");
    }
  });

  it("label format is MM-DD HH:00", () => {
    const points = getRequestPoints([]);
    for (const p of points) {
      expect(p.label).toMatch(/^\d{2}-\d{2} \d{2}:00$/);
    }
  });

  it("returns all zeros for empty logs", () => {
    const points = getRequestPoints([]);
    expect(points.every((p) => p.value === 0)).toBe(true);
  });

  it("counts requests in matching hour", () => {
    const logs = [makeLog(0), makeLog(0), makeLog(1)];
    const points = getRequestPoints(logs);
    expect(points[11].value).toBe(2); // current hour
    expect(points[10].value).toBe(1); // 1 hour ago
  });

  it("does not count logs outside the 12-hour window", () => {
    const logs = [makeLog(15)];
    const points = getRequestPoints(logs);
    expect(points.every((p) => p.value === 0)).toBe(true);
  });

  it("handles logs at different hours independently", () => {
    const logs = [
      makeLog(3),
      makeLog(3),
      makeLog(3),
      makeLog(7),
      makeLog(7),
    ];
    const points = getRequestPoints(logs);
    expect(points[8].value).toBe(3); // 3 hours ago = index 11-3=8
    expect(points[4].value).toBe(2); // 7 hours ago = index 11-7=4
  });
});
