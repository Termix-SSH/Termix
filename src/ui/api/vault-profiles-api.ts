import { authApi, handleApiError } from "@/main-axios";

export interface VaultProfilePayload {
  name: string;
  description?: string | null;
  folder?: string | null;
  tags?: string[];
  vaultAddr: string;
  vaultNamespace?: string | null;
  oidcMount?: string | null;
  oidcRole?: string | null;
  sshMount?: string | null;
  sshRole: string;
  validPrincipals?: string | null;
  keyType?: string | null;
  shared?: boolean;
}

export async function getVaultProfiles(): Promise<Record<string, unknown>[]> {
  try {
    const response = await authApi.get("/vault/profiles");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch vault profiles");
  }
}

export async function createVaultProfile(
  payload: VaultProfilePayload,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/vault/profiles", payload);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create vault profile");
  }
}

export async function updateVaultProfile(
  id: number,
  payload: Partial<VaultProfilePayload>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.put(`/vault/profiles/${id}`, payload);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update vault profile");
  }
}

export async function deleteVaultProfile(
  id: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete(`/vault/profiles/${id}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete vault profile");
  }
}
