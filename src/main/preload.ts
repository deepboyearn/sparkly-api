import { contextBridge, ipcRenderer } from "electron";
import type { BridgeState, CreateAccountInput, CreateClientKeyInput, DeleteAccountInput, DeleteClientKeyInput, PlaygroundModelsInput, PlaygroundModelsResult, PlaygroundTestInput, PlaygroundTestResult, ResetUsageInput, SaveConfigInput, SelectAccountInput, UpdateAccountInput, UpdateClientKeyInput } from "../shared/types";

contextBridge.exposeInMainWorld("bridgeApi", {
  getState: () => ipcRenderer.invoke("bridge:get-state") as Promise<BridgeState>,
  saveConfig: (config: SaveConfigInput) => ipcRenderer.invoke("bridge:save-config", config) as Promise<BridgeState>,
  restartServer: () => ipcRenderer.invoke("bridge:restart-server") as Promise<BridgeState>,
  createClientKey: (input: CreateClientKeyInput) => ipcRenderer.invoke("bridge:create-client-key", input) as Promise<BridgeState>,
  updateClientKey: (input: UpdateClientKeyInput) => ipcRenderer.invoke("bridge:update-client-key", input) as Promise<BridgeState>,
  deleteClientKey: (input: DeleteClientKeyInput) => ipcRenderer.invoke("bridge:delete-client-key", input) as Promise<BridgeState>,
  createAccount: (input: CreateAccountInput) => ipcRenderer.invoke("bridge:create-account", input) as Promise<BridgeState>,
  updateAccount: (input: UpdateAccountInput) => ipcRenderer.invoke("bridge:update-account", input) as Promise<BridgeState>,
  deleteAccount: (input: DeleteAccountInput) => ipcRenderer.invoke("bridge:delete-account", input) as Promise<BridgeState>,
  selectAccount: (input: SelectAccountInput) => ipcRenderer.invoke("bridge:select-account", input) as Promise<BridgeState>,
  refreshActiveAccountModels: () => ipcRenderer.invoke("bridge:refresh-active-account-models") as Promise<BridgeState>,
  resetUsage: (input: ResetUsageInput) => ipcRenderer.invoke("bridge:reset-usage", input) as Promise<BridgeState>,
  playgroundLoadModels: (input: PlaygroundModelsInput) => ipcRenderer.invoke("bridge:playground-load-models", input) as Promise<PlaygroundModelsResult>,
  playgroundTest: (input: PlaygroundTestInput) => ipcRenderer.invoke("bridge:playground-test", input) as Promise<PlaygroundTestResult>,
  openElectron: () => Promise.resolve(),
  openExternal: (url: string) => ipcRenderer.invoke("bridge:open-external", url) as Promise<void>,
  openDevTools: () => ipcRenderer.invoke("bridge:open-devtools") as Promise<void>,
});
