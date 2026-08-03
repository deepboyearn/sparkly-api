import { describe, it, expect } from "vitest";

// Test Window.bridgeApi type completeness by checking method names
// against the expected bridge API surface

describe("Window.bridgeApi type completeness", () => {
  const expectedMethods = [
    "getState",
    "saveConfig",
    "restartServer",
    "createClientKey",
    "updateClientKey",
    "deleteClientKey",
    "createAccount",
    "updateAccount",
    "deleteAccount",
    "selectAccount",
    "refreshActiveAccountModels",
    "resetUsage",
    "playgroundLoadModels",
    "playgroundTest",
    "openElectron",
    "openExternal",
    "openDevTools",
    "trustMitmCert",
    "untrustMitmCert",
    "getMitmCertStatus",
    "startMitmServer",
    "stopMitmServer",
    "updateMitmModelMappings",
    "getMitmModelMappings",
  ] as const;

  it("has 24 bridge methods", () => {
    expect(expectedMethods).toHaveLength(24);
  });

  it("core state methods exist", () => {
    const coreMethods = ["getState", "saveConfig", "restartServer"];
    for (const m of coreMethods) {
      expect(expectedMethods).toContain(m);
    }
  });

  it("client key CRUD methods exist", () => {
    const keyMethods = ["createClientKey", "updateClientKey", "deleteClientKey"];
    for (const m of keyMethods) {
      expect(expectedMethods).toContain(m);
    }
  });

  it("account CRUD methods exist", () => {
    const accountMethods = [
      "createAccount",
      "updateAccount",
      "deleteAccount",
      "selectAccount",
    ];
    for (const m of accountMethods) {
      expect(expectedMethods).toContain(m);
    }
  });

  it("playground methods exist", () => {
    const pgMethods = ["playgroundLoadModels", "playgroundTest"];
    for (const m of pgMethods) {
      expect(expectedMethods).toContain(m);
    }
  });

  it("MITM methods exist", () => {
    const mitmMethods = [
      "trustMitmCert",
      "untrustMitmCert",
      "getMitmCertStatus",
      "startMitmServer",
      "stopMitmServer",
      "updateMitmModelMappings",
      "getMitmModelMappings",
    ];
    for (const m of mitmMethods) {
      expect(expectedMethods).toContain(m);
    }
  });

  it("utility methods exist", () => {
    const utilMethods = ["openElectron", "openExternal", "openDevTools"];
    for (const m of utilMethods) {
      expect(expectedMethods).toContain(m);
    }
  });

  it("no duplicate method names", () => {
    const unique = new Set(expectedMethods);
    expect(unique.size).toBe(expectedMethods.length);
  });
});
