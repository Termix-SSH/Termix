import { authApi, handleApiError } from "@/main-axios";

export interface SecretSource {
  id: string;
  userId: string;
  name: string;
  kind: "onepassword-connect";
  baseUrl: string;
  shared: boolean;
  hasToken: boolean;
  owned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SecretSourcePayload {
  name: string;
  kind?: "onepassword-connect";
  baseUrl: string;
  token?: string;
  shared?: boolean;
}

export async function listSecretSources(): Promise<SecretSource[]> {
  try {
    return (await authApi.get("/secret-sources")).data.sources;
  } catch (error) {
    throw handleApiError(error, "list secret sources");
  }
}

export async function createSecretSource(
  payload: SecretSourcePayload,
): Promise<SecretSource> {
  try {
    return (await authApi.post("/secret-sources", payload)).data.source;
  } catch (error) {
    throw handleApiError(error, "create secret source");
  }
}

export async function updateSecretSource(
  id: string,
  payload: Partial<SecretSourcePayload>,
): Promise<void> {
  try {
    await authApi.put(`/secret-sources/${id}`, payload);
  } catch (error) {
    throw handleApiError(error, "update secret source");
  }
}

export async function deleteSecretSource(id: string): Promise<void> {
  try {
    await authApi.delete(`/secret-sources/${id}`);
  } catch (error) {
    throw handleApiError(error, "delete secret source");
  }
}

export async function testSecretSource(
  id: string,
): Promise<{ ok: boolean; vaults?: number; error?: string }> {
  try {
    return (await authApi.post(`/secret-sources/${id}/test`)).data;
  } catch (error) {
    throw handleApiError(error, "test secret source");
  }
}
