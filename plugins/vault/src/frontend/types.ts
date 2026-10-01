/** A Vault signer profile as GET /profiles returns it. */
export interface VaultProfile {
  id: number;
  name: string;
  vaultAddr: string;
  vaultNamespace: string | null;
  oidcMount: string | null;
  oidcRole: string | null;
  sshMount: string | null;
  sshRole: string;
  validPrincipals: string | null;
  keyType: string | null;
  shared: boolean;
  owned: boolean;
}

export interface VaultProfilePayload {
  name: string;
  vaultAddr: string;
  vaultNamespace: string | null;
  oidcMount: string | null;
  oidcRole: string | null;
  sshMount: string | null;
  sshRole: string;
  validPrincipals: string | null;
  keyType: string | null;
  shared: boolean;
}

export function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data;
  return typeof data?.error === "string" ? data.error : fallback;
}
