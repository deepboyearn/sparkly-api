import { describe, it, expect } from "vitest";
import { getDayPoints } from "../src/renderer/src/appState";
import type { RequestLogEntry } from "../src/shared/types";

function makeDayLog(daysAgo: number, overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return {
    id: `log-day-${daysAgo}`,
    timestamp: d.toISOString(),
    method: "POST",
    path: "/chat/completions",
    status: 200,
    model: "gpt-4",
    durationMs: 500,
    ...overrides,
  };
}

describe("getDayPoints", () => {
  it("returns array of length equal to count", () => {
    const points = getDayPoints([], "requests", 14);
    expect(points).toHaveLength(14);
  });

  it("returns default count of 14 when not specified", () => {
    const points = getDayPoints([], "requests");
    expect(points).toHaveLength(14);
  });

  it("each point has label and value", () => {
    const points = getDayPoints([], "requests", 7);
    for (const p of points) {
      expect(typeof p.label).toBe("string");
      expect(typeof p.value).toBe("number");
    }
  });

  it("label format is MM-DD 00:00", () => {
    const points = getDayPoints([], "requests", 1);
    expect(points[0].label).toMatch(/^\d{2}-\d{2} 00:00$/);
  });

  it("returns all zeros for empty logs", () => {
    const points = getDayPoints([], "requests", 14);
    expect(points.every((p) => p.value === 0)).toBe(true);
  });

  it("counts requests per day correctly", () => {
    const logs = [
      makeDayLog(0),
      makeDayLog(0),
      makeDayLog(0),
      makeDayLog(1),
    ];
    const points = getDayPoints(logs, "requests", 14);
    // Last point (index 13) = today, second to last (index 12) = yesterday
    expect(points[13].value).toBe(3);
    expect(points[12].value).toBe(1);
  });

  it("tokens type sums duration-based tokens per day", () => {
    const logs = [
      makeDayLog(2, { durationMs: 100 }),
      makeDayLog(2, { durationMs: 200 }),
    ];
    const points = getDayPoints(logs, "tokens", 14);
    // Day 2 ago = index 14 - 1 - 2 = 11
    expect(points[11].value).toBe(900); // 300 + 600
  });

  it("tokens type uses minimum 60 per entry", () => {
    const logs = [makeDayLog(0, { durationMs: 5 })];
    const points = getDayPoints(logs, "tokens", 1);
    expect(points[0].value).toBe(60); // max(60, 15) = 60
  });

  it("respects custom count parameter", () => {
    const points = getDayPoints([], "requests", 7);
    expect(points).toHaveLength(7);
  });
});
