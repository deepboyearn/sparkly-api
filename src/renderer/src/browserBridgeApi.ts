import type { CreateAccountInput, CreateClientKeyInput, DeleteAccountInput, DeleteClientKeyInput, PlaygroundModelsInput, PlaygroundTestInput, ResetUsageInput, SaveConfigInput, SelectAccountInput, UpdateAccountInput, UpdateClientKeyInput } from "../../shared/types";

const defaultControlBaseUrl = import.meta.env.VITE_BRIDGE_CONTROL_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${defaultControlBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Localhost bridge request failed with HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function jsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
  };
}

export function installBrowserBridgeApi() {
  if (window.bridgeApi) {
    return;
  }

  window.bridgeApi = {
    getState: () => request("/state"),
    saveConfig: (config: SaveConfigInput) => request("/config", jsonBody(config)),
    restartServer: () => request("/restart", jsonBody({})),
    createClientKey: (input: CreateClientKeyInput) => request("/client-keys", jsonBody(input)),
    updateClientKey: (input: UpdateClientKeyInput) => request(`/client-keys/${encodeURIComponent(input.id)}`, {
      method: "PUT",
      body: JSON.stringify({ name: input.name }),
    }),
    deleteClientKey: (input: DeleteClientKeyInput) => request(`/client-keys/${encodeURIComponent(input.id)}`, { method: "DELETE" }),
    createAccount: (input: CreateAccountInput) => request("/accounts", jsonBody(input)),
    updateAccount: (input: UpdateAccountInput) => request(`/accounts/${encodeURIComponent(input.id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
    deleteAccount: (input: DeleteAccountInput) => request(`/accounts/${encodeURIComponent(input.id)}`, { method: "DELETE" }),
    selectAccount: (input: SelectAccountInput) => request(`/accounts/${encodeURIComponent(input.id)}/select`, jsonBody({})),
    refreshActiveAccountModels: () => request("/accounts/refresh-models", jsonBody({})),
    resetUsage: (input: ResetUsageInput) => request("/usage/reset", jsonBody(input)),
    playgroundLoadModels: (input: PlaygroundModelsInput) => request("/playground/models", jsonBody(input)),
    playgroundTest: (input: PlaygroundTestInput) => request("/playground/test", jsonBody(input)),
    openElectron: async () => {
      await request("/electron/open", jsonBody({}));
    },
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    openDevTools: async () => undefined,
  };
}