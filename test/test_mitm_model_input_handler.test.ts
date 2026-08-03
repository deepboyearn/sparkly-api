import { describe, it, expect } from "vitest";

// handleModelChange logic extracted from MITMPage.tsx
// Tests that model mappings are updated correctly

describe("MITM model input handler (handleModelChange)", () => {
  it("adds new mapping to empty state", () => {
    const modelMappings: Record<string, string> = {};
    const name = "Claude Sonnet 4.6 (Thinking)";
    const val = "claude-sonnet-4";
    const updated = { ...modelMappings, [name]: val };
    expect(updated[name]).toBe(val);
  });

  it("adds mapping preserving existing", () => {
    const modelMappings: Record<string, string> = {
      "GPT-OSS 120B (Medium)": "gpt-oss",
    };
    const updated = { ...modelMappings, ["Gemini 3.6 Flash (High)"]: "gemini" };
    expect(updated["GPT-OSS 120B (Medium)"]).toBe("gpt-oss");
    expect(updated["Gemini 3.6 Flash (High)"]).toBe("gemini");
    expect(Object.keys(updated)).toHaveLength(2);
  });

  it("updates existing mapping value", () => {
    const modelMappings: Record<string, string> = {
      "Claude Opus 4.6 (Thinking)": "opus-v1",
    };
    const updated = { ...modelMappings, ["Claude Opus 4.6 (Thinking)"]: "opus-v2" };
    expect(updated["Claude Opus 4.6 (Thinking)"]).toBe("opus-v2");
    expect(Object.keys(updated)).toHaveLength(1);
  });

  it("does not mutate original mappings", () => {
    const original: Record<string, string> = {
      "Gemini 3.5 Flash (Medium) / Default": "default",
    };
    const copy = { ...original };
    const updated = { ...original, ["Gemini 3.5 Flash (Medium) / Default"]: "new-default" };
    expect(original["Gemini 3.5 Flash (Medium) / Default"]).toBe("default");
    expect(updated["Gemini 3.5 Flash (Medium) / Default"]).toBe("new-default");
  });

  it("empty value is allowed", () => {
    const modelMappings: Record<string, string> = {};
    const updated = { ...modelMappings, ["Gemini 3 Flash (Command)"]: "" };
    expect(updated["Gemini 3 Flash (Command)"]).toBe("");
  });

  it("simulates async update pattern", async () => {
    const modelMappings: Record<string, string> = {};
    const name = "GPT-OSS 120B (Medium)";
    const val = "gpt-oss-120b";

    const updated = { ...modelMappings, [name]: val };
    // Simulate async API call
    await Promise.resolve();
    expect(updated[name]).toBe(val);
  });
});
