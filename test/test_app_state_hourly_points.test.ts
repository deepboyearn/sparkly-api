import { describe, it, expect } from "vitest";
import { getHourlyPoints } from "../src/renderer/src/appState";
import type { RequestLogEntry } from "../src/shared/types";

function makeLog(hourOffset: number, overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  const d = new Date(Date.now() - hourOffset * 3600000);
  return {
    id: `log-${hourOffset}`,
    timestamp: d.toISOString(),
    method: "POST",
    path: "/chat/completions",
    status: 200,
    model: "gpt-4",
    durationMs: 500,
    ...overrides,
  };
}

describe("getHourlyPoints", () => {
  it("returns array of length equal to count", () => {
    const points = getHourlyPoints([], "requests", 24);
    expect(points).toHaveLength(24);
  });

  it("returns default count of 24 when not specified", () => {
    const points = getHourlyPoints([], "requests");
    expect(points).toHaveLength(24);
  });

  it("each point has label and value", () => {
    const points = getHourlyPoints([], "requests", 6);
    for (const p of points) {
      expect(typeof p.label).toBe("string");
      expect(typeof p.value).toBe("number");
    }
  });

  it("label format is MM-DD HH:00", () => {
    const points = getHourlyPoints([], "requests", 1);
    expect(points[0].label).toMatch(/^\d{2}-\d{2} \d{2}:00$/);
  });

  it("returns all zeros for empty logs", () => {
    const points = getHourlyPoints([], "requests", 24);
    expect(points.every((p) => p.value === 0)).toBe(true);
  });

  it("counts requests in matching hour", () => {
    const now = new Date();
    const logs = [
      makeLog(0),
      makeLog(0),
      makeLog(1),
    ];
    const points = getHourlyPoints(logs, "requests", 24);
    // First point (i=23) is 23 hours ago, last point (i=0) is now
    // Logs at hourOffset 0 are in the current hour (last point)
    // Logs at hourOffset 1 are 1 hour ago (second to last point)
    expect(points[23].value).toBe(2); // current hour: 2 logs
    expect(points[22].value).toBe(1); // 1 hour ago: 1 log
  });

  it("tokens type sums duration-based tokens", () => {
    const logs = [
      makeLog(5, { durationMs: 100 }),
      makeLog(5, { durationMs: 200 }),
    ];
    const points = getHourlyPoints(logs, "tokens", 24);
    // Hour 5 ago = index 24 - 1 - 5 = 18
    // Token = max(60, durationMs * 3)
    // 100ms → 300, 200ms → 600 → total 900
    expect(points[18].value).toBe(900);
  });

  it("tokens type uses minimum 60 per entry", () => {
    const logs = [makeLog(0, { durationMs: 10 })];
    const points = getHourlyPoints(logs, "tokens", 1);
    // max(60, 10 * 3) = 60
    expect(points[0].value).toBe(60);
  });

  it("respects custom count parameter", () => {
    const points = getHourlyPoints([], "requests", 6);
    expect(points).toHaveLength(6);
  });
});
