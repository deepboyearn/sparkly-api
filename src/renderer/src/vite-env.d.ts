/// <reference types="vite/client" />

import type { BridgeState, CreateAccountInput, CreateClientKeyInput, DeleteAccountInput, DeleteClientKeyInput, PlaygroundModelsInput, PlaygroundModelsResult, PlaygroundTestInput, PlaygroundTestResult, ResetUsageInput, SaveConfigInput, SelectAccountInput, UpdateAccountInput, UpdateClientKeyInput } from "../../shared/types";

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
      resetUsage: (input: ResetUsageInput) => Promise<BridgeState>;
      playgroundLoadModels: (input: PlaygroundModelsInput) => Promise<PlaygroundModelsResult>;
      playgroundTest: (input: PlaygroundTestInput) => Promise<PlaygroundTestResult>;
      openElectron: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      openDevTools: () => Promise<void>;
    };
  }
}
