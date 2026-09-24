import type { PluginApiClient } from "@termix/plugin-sdk/frontend";

export interface LdapProvider {
  id: number;
  name: string;
  enabled: boolean;
  displayOrder: number;
  config: Record<string, unknown>;
  hasBindPassword: boolean;
}

export interface LdapProviderInput {
  name?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/** Paths are relative to /plugin-api/ldap/. */
export function createLdapApi(api: PluginApiClient) {
  return {
    async list() {
      return (await api.get<{ providers: LdapProvider[] }>("/providers")).data
        .providers;
    },
    async create(input: LdapProviderInput) {
      return (await api.post<LdapProvider>("/providers", input)).data;
    },
    async update(id: number, input: LdapProviderInput) {
      return (await api.put<LdapProvider>(`/providers/${id}`, input)).data;
    },
    async remove(id: number) {
      await api.delete(`/providers/${id}`);
    },
  };
}
