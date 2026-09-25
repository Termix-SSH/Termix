export interface TermixIdentity {
  id: number;
  userId: string;
  handle: string;
  description: string | null;
  resolverPath?: string;
  resolverUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TermixIdentityKey {
  id: number;
  identityId: number;
  userId: string;
  publicKey: string;
  keyType: string;
  algorithm: string;
  label: string | null;
  comment: string | null;
  source: string;
  credentialId: number | null;
  enabled: boolean;
  createdAt: string;
}

export interface TermixIdMe {
  identity: TermixIdentity | null;
  keys: TermixIdentityKey[];
}

export interface GeneratedKey {
  key: TermixIdentityKey;
  privateKey: string;
  publicKey: string;
  credentialId: number | null;
}

export interface TermixIdCa {
  publicKey: string;
  validityDays: number;
  resolverPath: string;
  resolverUrl: string;
}

export interface IssuedCertificate {
  certificate: string;
  keyId: string;
  validBefore: number;
  principals: string[];
  validityDays: number;
}

export interface CredentialOption {
  id: number;
  name: string;
}

/** The server's error message when it sent one, else the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data;
  return typeof data?.error === "string" ? data.error : fallback;
}
