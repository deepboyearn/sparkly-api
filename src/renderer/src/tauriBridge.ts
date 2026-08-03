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
    trustMitmCert: () => invoke('trust_mitm_cert'),
    untrustMitmCert: () => invoke('untrust_mitm_cert'),
    getMitmCertStatus: () => invoke('get_mitm_cert_status'),
    startMitmServer: () => invoke('start_mitm_server_cmd'),
    stopMitmServer: () => invoke('stop_mitm_server_cmd'),
    updateMitmModelMappings: (mappings: Record<string, string>) => invoke('update_mitm_model_mappings', { mappings }),
    getMitmModelMappings: () => invoke('get_mitm_model_mappings'),
  };
}
