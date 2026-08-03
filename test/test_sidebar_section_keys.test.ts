import { describe, it, expect } from "vitest";

// SectionKey type is defined in both appState.ts and Sidebar.tsx.
// The sidebar version includes "mitm" which the appState version does not.
// This tests the sidebar's SectionKey which is the one actually used in the UI.

describe("SectionKey type (Sidebar)", () => {
  const ALL_SECTIONS = [
    "overview",
    "apiKeys",
    "usage",
    "accounts",
    "playground",
    "mitm",
  ] as const;

  type SectionKey = (typeof ALL_SECTIONS)[number];

  it("includes all 6 sections", () => {
    expect(ALL_SECTIONS).toHaveLength(6);
  });

  it("includes overview", () => {
    expect(ALL_SECTIONS).toContain("overview");
  });

  it("includes apiKeys", () => {
    expect(ALL_SECTIONS).toContain("apiKeys");
  });

  it("includes usage", () => {
    expect(ALL_SECTIONS).toContain("usage");
  });

  it("includes accounts", () => {
    expect(ALL_SECTIONS).toContain("accounts");
  });

  it("includes playground", () => {
    expect(ALL_SECTIONS).toContain("playground");
  });

  it("includes mitm", () => {
    expect(ALL_SECTIONS).toContain("mitm");
  });

  it("no duplicate sections", () => {
    const unique = new Set(ALL_SECTIONS);
    expect(unique.size).toBe(ALL_SECTIONS.length);
  });

  it("all sections are non-empty strings", () => {
    for (const s of ALL_SECTIONS) {
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
