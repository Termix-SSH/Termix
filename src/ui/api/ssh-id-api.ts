import { authApi, handleApiError } from "@/main-axios";

export interface SshIdentity {
  id: number;
  userId: string;
  handle: string;
  description: string | null;
  resolverPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SshIdentityKey {
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

export interface SshIdMe {
  identity: SshIdentity | null;
  keys: SshIdentityKey[];
}

export async function getMySshId(): Promise<SshIdMe> {
  try {
    const response = await authApi.get("/sshid/me");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch SSH ID");
  }
}

export async function checkSshIdHandle(
  handle: string,
): Promise<{ available: boolean; valid: boolean }> {
  try {
    const response = await authApi.get(
      `/sshid/check/${encodeURIComponent(handle)}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "check handle");
  }
}

export async function createSshId(
  handle: string,
  description?: string,
): Promise<SshIdentity> {
  try {
    const response = await authApi.post("/sshid", { handle, description });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create SSH ID");
  }
}

export async function updateSshId(data: {
  handle?: string;
  description?: string;
}): Promise<SshIdentity> {
  try {
    const response = await authApi.put("/sshid", data);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update SSH ID");
  }
}

export async function deleteSshId(): Promise<void> {
  try {
    await authApi.delete("/sshid");
  } catch (error) {
    throw handleApiError(error, "delete SSH ID");
  }
}

export async function addSshIdKey(data: {
  publicKey?: string;
  credentialId?: number;
  label?: string;
}): Promise<SshIdentityKey> {
  try {
    const response = await authApi.post("/sshid/keys", data);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "add key");
  }
}

export interface GeneratedKey {
  key: SshIdentityKey;
  privateKey: string;
  publicKey: string;
  credentialId: number | null;
}

export async function generateSshIdKey(
  type: "ed25519" | "rsa" = "ed25519",
  saveCredential = true,
): Promise<GeneratedKey> {
  try {
    const response = await authApi.post("/sshid/keys/generate", {
      type,
      saveCredential,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "generate key");
  }
}

export async function setSshIdKeyEnabled(
  id: number,
  enabled: boolean,
): Promise<SshIdentityKey> {
  try {
    const response = await authApi.patch(`/sshid/keys/${id}`, { enabled });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update key");
  }
}

export async function deleteSshIdKey(id: number): Promise<void> {
  try {
    await authApi.delete(`/sshid/keys/${id}`);
  } catch (error) {
    throw handleApiError(error, "delete key");
  }
}

export interface SshIdCa {
  publicKey: string;
  validityDays: number;
  resolverPath: string;
}

export interface IssuedCertificate {
  certificate: string;
  keyId: string;
  validBefore: number;
  principals: string[];
  validityDays: number;
}

export async function getMyCa(): Promise<{ ca: SshIdCa | null }> {
  try {
    const response = await authApi.get("/sshid/ca");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch CA");
  }
}

export async function createCa(validityDays?: number): Promise<SshIdCa> {
  try {
    const response = await authApi.post("/sshid/ca", { validityDays });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create CA");
  }
}

export async function rotateCa(validityDays?: number): Promise<SshIdCa> {
  try {
    const response = await authApi.post("/sshid/ca/rotate", { validityDays });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "rotate CA");
  }
}

export async function deleteCa(): Promise<void> {
  try {
    await authApi.delete("/sshid/ca");
  } catch (error) {
    throw handleApiError(error, "delete CA");
  }
}

export async function issueCertificate(
  keyId: number,
  opts: { principals?: string[]; validityDays?: number } = {},
): Promise<IssuedCertificate> {
  try {
    const response = await authApi.post(
      `/sshid/keys/${keyId}/certificate`,
      opts,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "issue certificate");
  }
}
