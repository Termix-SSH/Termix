import { authApi, handleApiError } from "@/main-axios";

// EXTERNAL ACCOUNT LINKING
// ============================================================================

export async function linkExternalToPasswordAccount(
  externalUserId: string,
  targetUsername: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/link-external-to-password", {
      externalUserId,
      targetUsername,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "link external account to password account");
  }
}

export async function unlinkExternalFromPasswordAccount(
  userId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post(
      "/users/unlink-external-from-password",
      { userId },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(
      error,
      "unlink external sign-in from password account",
    );
  }
}
