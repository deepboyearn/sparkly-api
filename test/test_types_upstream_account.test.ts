import { describe, it, expect } from "vitest";
import type { UpstreamAccount, AccountProvider, AccountUsageTag } from "../src/shared/types";

describe("UpstreamAccount type", () => {
  const validAccount: UpstreamAccount = {
    id: "acc-1",
    name: "My OpenAI Account",
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    usageTags: ["coding"],
    isActive: true,
    lastUsedAt: null,
  };

  it("has id as string", () => {
    expect(typeof validAccount.id).toBe("string");
  });

  it("has name as string", () => {
    expect(typeof validAccount.name).toBe("string");
  });

  it("has provider as AccountProvider", () => {
    const providers: AccountProvider[] = ["openai-compatible", "v0"];
    expect(providers).toContain(validAccount.provider);
  });

  it("has baseUrl as string", () => {
    expect(typeof validAccount.baseUrl).toBe("string");
  });

  it("has apiKey as string", () => {
    expect(typeof validAccount.apiKey).toBe("string");
  });

  it("has usageTags as AccountUsageTag array", () => {
    expect(Array.isArray(validAccount.usageTags)).toBe(true);
    for (const tag of validAccount.usageTags) {
      expect(tag).toBe("coding");
    }
  });

  it("has isActive as boolean", () => {
    expect(typeof validAccount.isActive).toBe("boolean");
  });

  it("has lastUsedAt as string or null", () => {
    expect(
      typeof validAccount.lastUsedAt === "string" || validAccount.lastUsedAt === null
    ).toBe(true);
  });

  it("AccountProvider only allows 'openai-compatible' or 'v0'", () => {
    const validProviders: AccountProvider[] = ["openai-compatible", "v0"];
    expect(validProviders).toHaveLength(2);
  });

  it("AccountUsageTag only allows 'coding'", () => {
    const validTags: AccountUsageTag[] = ["coding"];
    expect(validTags).toHaveLength(1);
  });

  it("v0 provider account shape", () => {
    const v0Account: UpstreamAccount = {
      ...validAccount,
      provider: "v0",
      baseUrl: "https://api.v0.dev/v1",
    };
    expect(v0Account.provider).toBe("v0");
  });
});
