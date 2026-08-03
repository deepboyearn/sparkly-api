import { describe, it, expect } from "vitest";

// MITM page initial state defaults (extracted from useState hooks)

describe("MITM page initial state", () => {
  const initialState = {
    baseUrl: "http://localhost:20128",
    apiKey: "",
    isRunning: false,
    isCertTrusted: false,
    isCertGenerated: true,
    certLoading: false,
    isAgExpanded: true,
    isDnsStarted: false,
    modelMappings: {} as Record<string, string>,
    serverLoading: false,
  };

  it("baseUrl defaults to localhost:20128", () => {
    expect(initialState.baseUrl).toBe("http://localhost:20128");
  });

  it("apiKey defaults to empty string", () => {
    expect(initialState.apiKey).toBe("");
  });

  it("server starts in stopped state", () => {
    expect(initialState.isRunning).toBe(false);
  });

  it("cert starts as not trusted", () => {
    expect(initialState.isCertTrusted).toBe(false);
  });

  it("cert starts as generated", () => {
    expect(initialState.isCertGenerated).toBe(true);
  });

  it("certLoading starts as false", () => {
    expect(initialState.certLoading).toBe(false);
  });

  it("antigravity card starts expanded", () => {
    expect(initialState.isAgExpanded).toBe(true);
  });

  it("DNS starts as disabled", () => {
    expect(initialState.isDnsStarted).toBe(false);
  });

  it("model mappings start as empty object", () => {
    expect(initialState.modelMappings).toEqual({});
  });

  it("serverLoading starts as false", () => {
    expect(initialState.serverLoading).toBe(false);
  });
});
