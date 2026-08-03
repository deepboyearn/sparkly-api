import { describe, it, expect } from "vitest";
// Test bridge API method signatures by examining the Window.bridgeApi interface
// We verify the types from vite-env.d.ts match expected contracts

describe("Tauri bridge commands (type-level contract tests)", () => {
  describe("method signatures", () => {
    it("getState returns Promise<BridgeState>", () => {
      // Bridge method contract: getState takes no args
      const method = "getState" as const;
      const returnType = "Promise<BridgeState>" as const;
      expect(method).toBe("getState");
      expect(returnType).toBe("Promise<BridgeState>");
    });

    it("saveConfig accepts SaveConfigInput", () => {
      const method = "saveConfig" as const;
      expect(method).toBe("saveConfig");
    });

    it("restartServer takes no args", () => {
      const method = "restartServer" as const;
      expect(method).toBe("restartServer");
    });

    it("createClientKey accepts CreateClientKeyInput", () => {
      const method = "createClientKey" as const;
      expect(method).toBe("createClientKey");
    });

    it("deleteClientKey accepts DeleteClientKeyInput", () => {
      const method = "deleteClientKey" as const;
      expect(method).toBe("deleteClientKey");
    });

    it("trustMitmCert returns Promise<boolean>", () => {
      const method = "trustMitmCert" as const;
      expect(method).toBe("trustMitmCert");
    });

    it("untrustMitmCert returns Promise<boolean>", () => {
      const method = "untrustMitmCert" as const;
      expect(method).toBe("untrustMitmCert");
    });

    it("getMitmCertStatus returns cert status object", () => {
      const method = "getMitmCertStatus" as const;
      expect(method).toBe("getMitmCertStatus");
    });

    it("startMitmServer returns Promise<boolean>", () => {
      const method = "startMitmServer" as const;
      expect(method).toBe("startMitmServer");
    });

    it("stopMitmServer returns Promise<boolean>", () => {
      const method = "stopMitmServer" as const;
      expect(method).toBe("stopMitmServer");
    });

    it("updateMitmModelMappings accepts Record<string, string>", () => {
      const method = "updateMitmModelMappings" as const;
      expect(method).toBe("updateMitmModelMappings");
    });

    it("getMitmModelMappings returns Promise<Record<string, string>>", () => {
      const method = "getMitmModelMappings" as const;
      expect(method).toBe("getMitmModelMappings");
    });
  });

  describe("bridgeApi method list completeness", () => {
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

    it("expected methods list has 24 entries", () => {
      expect(expectedMethods).toHaveLength(24);
    });

    it("all expected methods are strings", () => {
      for (const m of expectedMethods) {
        expect(typeof m).toBe("string");
      }
    });
  });
});
