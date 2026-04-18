/// <reference types="vite/client" />

import type { ActivateLicenseInput, BridgeState, ClearLicenseInput, CreateAccountInput, CreateClientKeyInput, DeleteAccountInput, DeleteClientKeyInput, GenerateRequestCodeInput, PlaygroundModelsInput, PlaygroundModelsResult, PlaygroundTestInput, PlaygroundTestResult, SaveConfigInput, SelectAccountInput, UpdateAccountInput, UpdateClientKeyInput } from "../../shared/types";

declare global {
  interface Window {
    bridgeApi: {
      getState: () => Promise<BridgeState>;
      saveConfig: (config: SaveConfigInput) => Promise<BridgeState>;
      restartServer: () => Promise<BridgeState>;
      createClientKey: (input: CreateClientKeyInput) => Promise<BridgeState>;
      updateClientKey: (input: UpdateClientKeyInput) => Promise<BridgeState>;
      deleteClientKey: (input: DeleteClientKeyInput) => Promise<BridgeState>;
      createAccount: (input: CreateAccountInput) => Promise<BridgeState>;
      updateAccount: (input: UpdateAccountInput) => Promise<BridgeState>;
      deleteAccount: (input: DeleteAccountInput) => Promise<BridgeState>;
      selectAccount: (input: SelectAccountInput) => Promise<BridgeState>;
      refreshActiveAccountModels: () => Promise<BridgeState>;
      activateLicense: (input: ActivateLicenseInput) => Promise<BridgeState>;
      clearLicense: (input: ClearLicenseInput) => Promise<BridgeState>;
      generateRequestCode: (input: GenerateRequestCodeInput) => Promise<BridgeState>;
      playgroundLoadModels: (input: PlaygroundModelsInput) => Promise<PlaygroundModelsResult>;
      playgroundTest: (input: PlaygroundTestInput) => Promise<PlaygroundTestResult>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
