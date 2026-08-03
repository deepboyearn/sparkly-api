import { describe, it, expect } from "vitest";

// Model mapping persistence logic for MITM page

describe("MITM page model mappings", () => {
  it("starts as empty Record<string, string>", () => {
    const mappings: Record<string, string> = {};
    expect(mappings).toEqual({});
    expect(typeof mappings).toBe("object");
  });

  it("adding a mapping creates key-value pair", () => {
    const mappings: Record<string, string> = {};
    const updated = { ...mappings, ["Claude Sonnet 4.6 (Thinking)"]: "claude-sonnet-4" };
    expect(updated["Claude Sonnet 4.6 (Thinking)"]).toBe("claude-sonnet-4");
  });

  it("multiple mappings coexist", () => {
    const mappings: Record<string, string> = {
      "Claude Sonnet 4.6 (Thinking)": "claude-sonnet-4",
      "GPT-OSS 120B (Medium)": "gpt-oss-120b",
    };
    expect(Object.keys(mappings)).toHaveLength(2);
  });

  it("updating a mapping replaces the value", () => {
    const mappings: Record<string, string> = {
      "Claude Sonnet 4.6 (Thinking)": "claude-sonnet-4",
    };
    const updated = { ...mappings, ["Claude Sonnet 4.6 (Thinking)"]: "claude-v2" };
    expect(updated["Claude Sonnet 4.6 (Thinking)"]).toBe("claude-v2");
    expect(Object.keys(updated)).toHaveLength(1);
  });

  it("handleModelChange pattern: spread + new key", () => {
    const modelMappings: Record<string, string> = {};
    const name = "Gemini 3.6 Flash (High)";
    const val = "gemini-3.6-flash-high";
    const updated = { ...modelMappings, [name]: val };
    expect(updated[name]).toBe(val);
  });

  it("handleModelChange pattern: preserve existing mappings", () => {
    const modelMappings: Record<string, string> = {
      "GPT-OSS 120B (Medium)": "gpt-oss",
    };
    const updated = { ...modelMappings, ["Claude Opus 4.6 (Thinking)"]: "opus" };
    expect(updated["GPT-OSS 120B (Medium)"]).toBe("gpt-oss");
    expect(updated["Claude Opus 4.6 (Thinking)"]).toBe("opus");
  });

  it("serialization round-trip preserves mappings", () => {
    const original: Record<string, string> = {
      "Gemini 3.5 Flash (Medium) / Default": "gemini-default",
      "Claude Sonnet 4.6 (Thinking)": "claude-sonnet",
    };
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as Record<string, string>;
    expect(parsed).toEqual(original);
  });
});
