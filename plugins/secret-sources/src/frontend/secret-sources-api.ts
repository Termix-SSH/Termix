import type { PluginApiClient } from "@termix/plugin-sdk/frontend";

export type SecretSourceKind = "onepassword-connect";

export interface SecretSource {
  id: string;
  name: string;
  kind: SecretSourceKind;
  baseUrl: string;
  shared: boolean;
  owned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SecretSourceInput {
  name: string;
  baseUrl: string;
  token: string;
  shared?: boolean;
}

export interface SecretSourceUpdateInput {
  name?: string;
  baseUrl?: string;
  token?: string;
  shared?: boolean;
}

/** The secret-sources routes, through the plugin's own client. */
export function createSecretSourcesApi(api: PluginApiClient) {
  const data = async <T>(request: Promise<{ data: T }>) => (await request).data;

  return {
    list: () =>
      data(api.get<{ sources: SecretSource[] }>("/")).then((r) => r.sources),
    create: (body: SecretSourceInput) =>
      data(api.post<{ source: SecretSource }>("/", body)).then((r) => r.source),
    update: (id: string, body: SecretSourceUpdateInput) =>
      data(api.put<{ success: boolean }>(`/${id}`, body)),
    remove: (id: string) => data(api.delete<{ success: boolean }>(`/${id}`)),
    test: (id: string) =>
      data(
        api.post<{ ok: boolean; vaults?: number; error?: string }>(
          `/${id}/test`,
        ),
      ),
  };
}

export type SecretSourcesApi = ReturnType<typeof createSecretSourcesApi>;
