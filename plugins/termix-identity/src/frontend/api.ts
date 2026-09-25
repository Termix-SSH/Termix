import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import type {
  CredentialOption,
  GeneratedKey,
  IssuedCertificate,
  TermixIdCa,
  TermixIdentity,
  TermixIdentityKey,
  TermixIdMe,
} from "./types";

/** The Termix ID routes, relative to /plugin-api/termix-identity/. */
export function createTermixIdApi(api: PluginApiClient) {
  const data = async <T>(request: Promise<{ data: T }>) => (await request).data;

  return {
    me: () => data(api.get<TermixIdMe>("/me")),
    checkHandle: (handle: string) =>
      data(
        api.get<{ available: boolean; valid: boolean }>(
          `/check/${encodeURIComponent(handle)}`,
        ),
      ),
    create: (handle: string, description?: string) =>
      data(api.post<TermixIdentity>("/", { handle, description })),
    update: (body: { handle?: string; description?: string }) =>
      data(api.put<TermixIdentity>("/", body)),
    remove: () => data(api.delete<{ success: boolean }>("/")),
    addKey: (body: {
      publicKey?: string;
      credentialId?: number;
      label?: string;
    }) => data(api.post<TermixIdentityKey>("/keys", body)),
    generateKey: (type: "ed25519" | "rsa", saveCredential: boolean) =>
      data(api.post<GeneratedKey>("/keys/generate", { type, saveCredential })),
    setKeyEnabled: (id: number, enabled: boolean) =>
      data(api.patch<TermixIdentityKey>(`/keys/${id}`, { enabled })),
    removeKey: (id: number) =>
      data(api.delete<{ success: boolean }>(`/keys/${id}`)),
    ca: () => data(api.get<{ ca: TermixIdCa | null }>("/ca")),
    createCa: (validityDays?: number) =>
      data(api.post<TermixIdCa>("/ca", { validityDays })),
    rotateCa: (validityDays?: number) =>
      data(api.post<TermixIdCa>("/ca/rotate", { validityDays })),
    removeCa: () => data(api.delete<{ success: boolean }>("/ca")),
    issueCertificate: (
      keyId: number,
      body: { principals?: string[]; validityDays?: number } = {},
    ) => data(api.post<IssuedCertificate>(`/keys/${keyId}/certificate`, body)),
    linkedCredentialIds: () =>
      data(api.get<{ credentialIds: number[] }>("/linked-credentials")),
    credentials: () =>
      data(api.get<{ credentials: CredentialOption[] }>("/credentials")),
  };
}

export type TermixIdApi = ReturnType<typeof createTermixIdApi>;
