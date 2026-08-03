import { describe, it, expect } from "vitest";

// AG_MODELS array from MITMPage.tsx - extracted as a constant for testing

const AG_MODELS = [
  "Gemini 3.6 Flash (High)",
  "Gemini 3.6 Flash (Medium)",
  "Gemini 3.6 Flash (Low)",
  "Gemini 3.5 Flash (Medium) / Default",
  "Gemini 3.5 Flash (High)",
  "Gemini 3.5 Flash (Low)",
  "Gemini 3.1 Pro (Low)",
  "Gemini 3.1 Pro (High)",
  "Claude Sonnet 4.6 (Thinking)",
  "Claude Opus 4.6 (Thinking)",
  "GPT-OSS 120B (Medium)",
  "Gemini 3 Flash (Command)",
];

describe("AG_MODELS array", () => {
  it("has exactly 12 items", () => {
    expect(AG_MODELS).toHaveLength(12);
  });

  it("all items are non-empty strings", () => {
    for (const model of AG_MODELS) {
      expect(typeof model).toBe("string");
      expect(model.length).toBeGreaterThan(0);
    }
  });

  it("no duplicate model names", () => {
    const unique = new Set(AG_MODELS);
    expect(unique.size).toBe(AG_MODELS.length);
  });

  it("contains Gemini models", () => {
    const geminiModels = AG_MODELS.filter((m) => m.includes("Gemini"));
    expect(geminiModels.length).toBeGreaterThan(0);
  });

  it("contains Claude models", () => {
    const claudeModels = AG_MODELS.filter((m) => m.includes("Claude"));
    expect(claudeModels.length).toBeGreaterThan(0);
  });

  it("contains GPT models", () => {
    const gptModels = AG_MODELS.filter((m) => m.includes("GPT"));
    expect(gptModels.length).toBeGreaterThan(0);
  });

  it("first model is Gemini 3.6 Flash (High)", () => {
    expect(AG_MODELS[0]).toBe("Gemini 3.6 Flash (High)");
  });

  it("last model is Gemini 3 Flash (Command)", () => {
    expect(AG_MODELS[11]).toBe("Gemini 3 Flash (Command)");
  });

  it("default model is Gemini 3.5 Flash (Medium) / Default", () => {
    const defaultModel = AG_MODELS.find((m) => m.includes("Default"));
    expect(defaultModel).toBe("Gemini 3.5 Flash (Medium) / Default");
  });

  it("models with thinking capability", () => {
    const thinkingModels = AG_MODELS.filter((m) => m.includes("Thinking"));
    expect(thinkingModels).toHaveLength(2);
  });
});
