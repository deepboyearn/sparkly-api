import { invoke } from '@tauri-apps/api/core';

export function installTauriBridgeApi() {
  if (window.bridgeApi) return;

  window.bridgeApi = {
    getState: () => invoke('get_state'),
    saveConfig: (config) => invoke('save_config', { config }),
    restartServer: () => invoke('restart_server'),
    createClientKey: (input) => invoke('create_client_key', { input }),
    updateClientKey: (input) => invoke('update_client_key', { input }),
    deleteClientKey: (input) => invoke('delete_client_key', { input }),
    createAccount: (input) => invoke('create_account', { input }),
    updateAccount: (input) => invoke('update_account', { input }),
    deleteAccount: (input) => invoke('delete_account', { input }),
    selectAccount: (input) => invoke('select_account', { input }),
    refreshActiveAccountModels: () => invoke('refresh_active_account_models'),
    resetUsage: (input) => invoke('reset_usage', { input }),
    playgroundLoadModels: (input) => invoke('playground_load_models', { input }),
    playgroundTest: (input) => invoke('playground_test', { input }),
    openElectron: async () => {},
    openExternal: async (url: string) => { window.open(url, '_blank', 'noopener,noreferrer'); },
    openDevTools: async () => {},
  };
}
