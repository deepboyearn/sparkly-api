import { describe, it, expect } from "vitest";
import type {
  PlaygroundTestInput,
  PlaygroundTestResult,
  PlaygroundModelsInput,
  PlaygroundModelsResult,
} from "../src/shared/types";

describe("PlaygroundTestInput type", () => {
  const validInput: PlaygroundTestInput = {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4",
    message: "Hello, world!",
  };

  it("has baseUrl as string", () => {
    expect(typeof validInput.baseUrl).toBe("string");
  });

  it("has apiKey as string", () => {
    expect(typeof validInput.apiKey).toBe("string");
  });

  it("has model as string", () => {
    expect(typeof validInput.model).toBe("string");
  });

  it("has message as string", () => {
    expect(typeof validInput.message).toBe("string");
  });

  it("systemPrompt is optional", () => {
    const without: PlaygroundTestInput = {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk",
      model: "gpt-4",
      message: "hi",
    };
    expect(without.systemPrompt).toBeUndefined();

    const withPrompt: PlaygroundTestInput = {
      ...without,
      systemPrompt: "Be helpful",
    };
    expect(withPrompt.systemPrompt).toBe("Be helpful");
  });
});

describe("PlaygroundTestResult type", () => {
  const successResult: PlaygroundTestResult = {
    ok: true,
    status: 200,
    model: "gpt-4",
    content: "Hello!",
    raw: { choices: [] },
  };

  const errorResult: PlaygroundTestResult = {
    ok: false,
    status: 401,
    model: "gpt-4",
    content: "",
    raw: { error: { message: "Unauthorized" } },
    error: "Unauthorized",
  };

  it("has ok as boolean", () => {
    expect(typeof successResult.ok).toBe("boolean");
  });

  it("has status as number", () => {
    expect(typeof successResult.status).toBe("number");
  });

  it("has model as string", () => {
    expect(typeof successResult.model).toBe("string");
  });

  it("has content as string", () => {
    expect(typeof successResult.content).toBe("string");
  });

  it("has raw as unknown", () => {
    expect(successResult.raw).toBeDefined();
  });

  it("error field is optional", () => {
    expect(successResult.error).toBeUndefined();
    expect(errorResult.error).toBe("Unauthorized");
  });
});

describe("PlaygroundModelsInput type", () => {
  it("has baseUrl and apiKey", () => {
    const input: PlaygroundModelsInput = {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    };
    expect(typeof input.baseUrl).toBe("string");
    expect(typeof input.apiKey).toBe("string");
  });
});

describe("PlaygroundModelsResult type", () => {
  it("has ok, status, models, raw", () => {
    const result: PlaygroundModelsResult = {
      ok: true,
      status: 200,
      models: ["gpt-4", "gpt-3.5-turbo"],
      raw: {},
    };
    expect(result.ok).toBe(true);
    expect(result.models).toHaveLength(2);
  });

  it("error is optional", () => {
    const result: PlaygroundModelsResult = {
      ok: false,
      status: 500,
      models: [],
      raw: {},
      error: "Server error",
    };
    expect(result.error).toBe("Server error");
  });
});
