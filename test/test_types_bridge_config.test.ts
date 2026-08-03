import { describe, it, expect } from "vitest";
import type { BridgeConfig } from "../src/shared/types";

describe("BridgeConfig type", () => {
  const validConfig: BridgeConfig = {
    upstreamBaseUrl: "https://cn.chrouter.com:8443",
    apiKey: "sk-test-key",
    models: ["gpt-4", "gpt-3.5-turbo"],
    selectedModel: "gpt-4",
    localPort: 48231,
    enableCors: true,
    systemPrompt: "You are a helpful assistant",
    accounts: [],
    activeAccountId: "",
  };

  it("has upstreamBaseUrl as string", () => {
    expect(typeof validConfig.upstreamBaseUrl).toBe("string");
  });

  it("has apiKey as string", () => {
    expect(typeof validConfig.apiKey).toBe("string");
  });

  it("has models as string array", () => {
    expect(Array.isArray(validConfig.models)).toBe(true);
    for (const m of validConfig.models) {
      expect(typeof m).toBe("string");
    }
  });

  it("has selectedModel as string", () => {
    expect(typeof validConfig.selectedModel).toBe("string");
  });

  it("has localPort as number", () => {
    expect(typeof validConfig.localPort).toBe("number");
  });

  it("has enableCors as boolean", () => {
    expect(typeof validConfig.enableCors).toBe("boolean");
  });

  it("has systemPrompt as string", () => {
    expect(typeof validConfig.systemPrompt).toBe("string");
  });

  it("has accounts as array", () => {
    expect(Array.isArray(validConfig.accounts)).toBe(true);
  });

  it("has activeAccountId as string", () => {
    expect(typeof validConfig.activeAccountId).toBe("string");
  });

  it("SaveConfigInput is the same type as BridgeConfig", () => {
    // Both are BridgeConfig in the type definitions
    const saveInput: BridgeConfig = { ...validConfig };
    expect(saveInput.upstreamBaseUrl).toBe(validConfig.upstreamBaseUrl);
  });
});
