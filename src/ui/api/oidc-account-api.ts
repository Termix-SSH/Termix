import { authApi, handleApiError } from "@/main-axios";

// OIDC ACCOUNT LINKING
// ============================================================================

export async function linkOIDCToPasswordAccount(
  oidcUserId: string,
  targetUsername: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/link-oidc-to-password", {
      oidcUserId,
      targetUsername,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "link OIDC account to password account");
  }
}

export async function unlinkOIDCFromPasswordAccount(
  userId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/unlink-oidc-from-password", {
      userId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "unlink OIDC from password account");
  }
}
