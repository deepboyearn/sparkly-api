import { invoke } from '@tauri-apps/api/core';
import { logIpcCall, logSystem } from './consoleLogStore';
import type { BridgeState, PlaygroundModelsResult, PlaygroundTestResult, RuntimeSnapshot } from '../../shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function timedInvoke<T = unknown>(method: string, args?: Record<string, unknown>, silent = false): Promise<T> {
  const start = performance.now();
  const result = invoke<T>(method, args);
  if (!silent) {
    result
      .then((res) => {
        logIpcCall(method, args ?? null, res, Math.round(performance.now() - start));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logIpcCall(method, args ?? null, null, Math.round(performance.now() - start), msg);
      });
  }
  return result;
}

export const SPARKLY_RUNTIME_IDENTITY = 'sparkly-api:com.sparklyapi.sparklyapi:v1';

export async function verifySparklyRuntime() {
  try {
    return await invoke<string>('sparkly_runtime_identity') === SPARKLY_RUNTIME_IDENTITY;
  } catch {
    return false;
  }
}

export function installTauriBridgeApi() {
  if (window.bridgeApi) return;

  logSystem("Sparkly API console initialized");

  window.bridgeApi = {
    getState: () => timedInvoke<BridgeState>('get_state', undefined, true),
    getRuntimeSnapshot: () => timedInvoke<RuntimeSnapshot>('get_runtime_snapshot', undefined, true),
    saveConfig: (config) => timedInvoke<BridgeState>('save_config', { config }),
    restartServer: () => timedInvoke<BridgeState>('restart_server'),
    createClientKey: (input) => timedInvoke<BridgeState>('create_client_key', { input }),
    updateClientKey: (input) => timedInvoke<BridgeState>('update_client_key', { input }),
    deleteClientKey: (input) => timedInvoke<BridgeState>('delete_client_key', { input }),
    createAccount: (input) => timedInvoke<BridgeState>('create_account', { input }),
    updateAccount: (input) => timedInvoke<BridgeState>('update_account', { input }),
    deleteAccount: (input) => timedInvoke<BridgeState>('delete_account', { input }),
    selectAccount: (input) => timedInvoke<BridgeState>('select_account', { input }),
    refreshActiveAccountModels: () => timedInvoke<BridgeState>('refresh_active_account_models'),
    resetUsage: (input) => timedInvoke<BridgeState>('reset_usage', { input }),
    playgroundLoadModels: (input) => timedInvoke<PlaygroundModelsResult>('playground_load_models', { input }),
    playgroundTest: (input) => timedInvoke<PlaygroundTestResult>('playground_test', { input }),
    openExternal: async (url: string) => { window.open(url, '_blank', 'noopener,noreferrer'); },
    trustMitmCert: () => timedInvoke<boolean>('trust_mitm_cert'),
    untrustMitmCert: () => timedInvoke<boolean>('untrust_mitm_cert'),
    getMitmCertStatus: () => timedInvoke<{ exists: boolean; trusted: boolean; running: boolean }>('get_mitm_cert_status'),
    startMitmServer: () => timedInvoke<boolean>('start_mitm_server_cmd'),
    stopMitmServer: () => timedInvoke<boolean>('stop_mitm_server_cmd'),
    updateMitmModelMappings: (mappings: Record<string, string>) => timedInvoke<void>('update_mitm_model_mappings', { mappings }),
    getMitmModelMappings: () => timedInvoke<Record<string, string>>('get_mitm_model_mappings'),
  };
}
