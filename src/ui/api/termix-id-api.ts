import { authApi, handleApiError } from "@/main-axios";

export interface TermixIdentity {
  id: number;
  userId: string;
  handle: string;
  description: string | null;
  resolverPath?: string;
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

export async function getMyTermixId(): Promise<TermixIdMe> {
  try {
    const response = await authApi.get("/termix-id/me");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch Termix ID");
  }
}

export async function checkTermixIdHandle(
  handle: string,
): Promise<{ available: boolean; valid: boolean }> {
  try {
    const response = await authApi.get(
      `/termix-id/check/${encodeURIComponent(handle)}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "check handle");
  }
}

export async function createTermixId(
  handle: string,
  description?: string,
): Promise<TermixIdentity> {
  try {
    const response = await authApi.post("/termix-id", { handle, description });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create Termix ID");
  }
}

export async function updateTermixId(data: {
  handle?: string;
  description?: string;
}): Promise<TermixIdentity> {
  try {
    const response = await authApi.put("/termix-id", data);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update Termix ID");
  }
}

export async function deleteTermixId(): Promise<void> {
  try {
    await authApi.delete("/termix-id");
  } catch (error) {
    throw handleApiError(error, "delete Termix ID");
  }
}

export async function addTermixIdKey(data: {
  publicKey?: string;
  credentialId?: number;
  label?: string;
}): Promise<TermixIdentityKey> {
  try {
    const response = await authApi.post("/termix-id/keys", data);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "add key");
  }
}

export interface GeneratedKey {
  key: TermixIdentityKey;
  privateKey: string;
  publicKey: string;
  credentialId: number | null;
}

export async function generateTermixIdKey(
  type: "ed25519" | "rsa" = "ed25519",
  saveCredential = true,
): Promise<GeneratedKey> {
  try {
    const response = await authApi.post("/termix-id/keys/generate", {
      type,
      saveCredential,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "generate key");
  }
}

export async function setTermixIdKeyEnabled(
  id: number,
  enabled: boolean,
): Promise<TermixIdentityKey> {
  try {
    const response = await authApi.patch(`/termix-id/keys/${id}`, { enabled });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update key");
  }
}

export async function deleteTermixIdKey(id: number): Promise<void> {
  try {
    await authApi.delete(`/termix-id/keys/${id}`);
  } catch (error) {
    throw handleApiError(error, "delete key");
  }
}

export interface TermixIdCa {
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

export async function getMyCa(): Promise<{ ca: TermixIdCa | null }> {
  try {
    const response = await authApi.get("/termix-id/ca");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch CA");
  }
}

export async function createCa(validityDays?: number): Promise<TermixIdCa> {
  try {
    const response = await authApi.post("/termix-id/ca", { validityDays });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create CA");
  }
}

export async function rotateCa(validityDays?: number): Promise<TermixIdCa> {
  try {
    const response = await authApi.post("/termix-id/ca/rotate", {
      validityDays,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "rotate CA");
  }
}

export async function deleteCa(): Promise<void> {
  try {
    await authApi.delete("/termix-id/ca");
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
      `/termix-id/keys/${keyId}/certificate`,
      opts,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "issue certificate");
  }
}

export async function getLinkedCredentialIds(): Promise<{
  credentialIds: number[];
}> {
  try {
    const response = await authApi.get("/termix-id/linked-credentials");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch linked credentials");
  }
}
