import { authApi, handleApiError, type UserInfo } from "@/main-axios";
import { getConnectedRemoteApi } from "@/lib/remote-server-api";

// USER MANAGEMENT
// ============================================================================

export type UserListOptions = {
  /** Case-insensitive username substring filter. */
  search?: string;
  /** Page size. Omit to fetch every user (what the share pickers want). */
  limit?: number;
  offset?: number;
};

export async function getUserList(
  options: UserListOptions = {},
): Promise<{ users: UserInfo[]; total?: number }> {
  try {
    const api = (await getConnectedRemoteApi()) ?? authApi;
    const response = await api.get("/users/list", {
      params: {
        ...(options.search ? { search: options.search } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
        ...(options.offset ? { offset: options.offset } : {}),
      },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch user list");
  }
}

export async function getSessions(): Promise<{
  sessions: {
    id: string;
    userId: string;
    username?: string;
    deviceType: string;
    deviceInfo: string;
    createdAt: string;
    expiresAt: string;
    lastActiveAt: string;
    isRevoked?: boolean;
    isCurrentSession?: boolean;
  }[];
}> {
  try {
    const response = await authApi.get("/users/sessions");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch sessions");
  }
}

export async function revokeSession(
  sessionId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.delete(`/users/sessions/${sessionId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "revoke session");
  }
}

export async function revokeAllUserSessions(
  userId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/sessions/revoke-all", {
      targetUserId: userId,
      exceptCurrent: false,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "revoke all user sessions");
  }
}

export interface ApiKey {
  id: string;
  name: string;
  userId: string;
  username: string | null;
  tokenPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isActive: boolean;
  /** Null for full access. */
  scopes?: string[] | null;
}

export interface CreatedApiKey extends ApiKey {
  token: string;
}

/**
 * Leave expiresAt out for the server's 90 days, or pass null for never.
 * Leave scopes out for read only, or pass ["full"] for no limits.
 */
export async function createApiKey(
  name: string,
  userId: string,
  expiresAt?: string | null,
  scopes?: string[] | null,
): Promise<CreatedApiKey> {
  try {
    const response = await authApi.post("/users/api-keys", {
      name,
      userId,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(scopes?.length ? { scopes } : {}),
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "create API key");
  }
}

export async function getApiKeys(): Promise<{ apiKeys: ApiKey[] }> {
  try {
    const response = await authApi.get("/users/api-keys");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch API keys");
  }
}

export async function deleteApiKey(
  keyId: string,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(`/users/api-keys/${keyId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "delete API key");
  }
}

/** The signed in user's own API keys. */
export async function getMyApiKeys(): Promise<{ apiKeys: ApiKey[] }> {
  try {
    const response = await authApi.get("/users/api-keys/mine");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch your API keys");
  }
}

export async function revokeMyApiKey(
  keyId: string,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(
      `/users/api-keys/mine/${encodeURIComponent(keyId)}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "revoke your API key");
  }
}

export async function revokeAllMyApiKeys(): Promise<{ count: number }> {
  try {
    const response = await authApi.post("/users/api-keys/mine/revoke-all");
    return response.data;
  } catch (error) {
    handleApiError(error, "revoke your API keys");
  }
}

/** Admin only: ends every session but this one, and every key when asked. */
export async function revokeEveryoneSessions(options?: {
  apiKeys?: boolean;
}): Promise<{ sessions: number; apiKeys: number }> {
  try {
    const response = await authApi.post("/users/sessions/revoke-everyone", {
      apiKeys: options?.apiKeys === true,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "sign everyone out");
  }
}

/** What a held admin change answers instead of applying (HTTP 202). */
export interface AdminHoldTicket {
  held: true;
  holdId: string;
  runsAt: string;
  minutes: number;
  message?: string;
}

export function isAdminHoldTicket(value: unknown): value is AdminHoldTicket {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { held?: unknown }).held === true &&
    typeof (value as { holdId?: unknown }).holdId === "string"
  );
}

export interface AdminHoldSettings {
  /** 0 means off. */
  minutes: number;
  forcedByEnv: boolean;
  adminCount: number;
  active: boolean;
  envName: string;
}

export interface AdminHold {
  id: string;
  kind: string;
  summary: string;
  requestedBy: string | null;
  requestedByName: string;
  requestedAt: string;
  runsAt: string;
  status: "pending" | "applying" | "applied" | "cancelled" | "failed";
  decidedBy: string | null;
  decidedAt: string | null;
  error: string | null;
}

export async function getAdminHoldSettings(): Promise<AdminHoldSettings> {
  try {
    const response = await authApi.get("/users/admin-holds/settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "read the admin wait setting");
  }
}

export async function setAdminHoldMinutes(
  minutes: number,
): Promise<{ held: false; minutes: number } | AdminHoldTicket> {
  try {
    const response = await authApi.put("/users/admin-holds/settings", {
      minutes,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "save the admin wait setting");
  }
}

export async function getAdminHolds(): Promise<{ holds: AdminHold[] }> {
  try {
    const response = await authApi.get("/users/admin-holds");
    return response.data;
  } catch (error) {
    handleApiError(error, "list waiting admin changes");
  }
}

export async function cancelAdminHold(
  holdId: string,
): Promise<{ cancelled: boolean }> {
  try {
    const response = await authApi.post(
      `/users/admin-holds/${encodeURIComponent(holdId)}/cancel`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "cancel the admin change");
  }
}

export async function makeUserAdmin(
  userId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/make-admin", { userId });
    return response.data;
  } catch (error) {
    handleApiError(error, "make user admin");
  }
}

export async function removeAdminStatus(
  userId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/users/remove-admin", { userId });
    return response.data;
  } catch (error) {
    handleApiError(error, "remove admin status");
  }
}

export async function deleteUser(
  username: string,
  successorUserId?: string | "none",
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/users/delete-user", {
      data: { username, successorUserId },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "delete user");
  }
}

export async function deleteAccount(
  password: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete("/users/delete-account", {
      data: { password },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "delete account");
  }
}

// Raw axios errors propagate here so callers can detect the 409
// DATA_WIPE_REQUIRED code and re-submit with confirmDataWipe.
export async function adminResetUserPassword(
  userId: string,
  newPassword: string,
  confirmDataWipe = false,
): Promise<{ message: string; dataWiped?: boolean }> {
  const response = await authApi.post("/users/admin/reset-password", {
    userId,
    newPassword,
    confirmDataWipe,
  });
  return response.data;
}

export async function adminExportUserData(
  userId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get(
      `/users/admin/export/${encodeURIComponent(userId)}`,
      { timeout: 120000 },
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "export user data");
  }
}

export async function updateRegistrationAllowed(
  allowed: boolean,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.patch("/users/registration-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update registration allowed");
  }
}

export async function getExternalAutoProvision(): Promise<{
  enabled: boolean;
}> {
  try {
    const response = await authApi.get("/users/external-auto-provision");
    return response.data;
  } catch (error) {
    handleApiError(error, "check OIDC auto-provision status");
  }
}

export async function updateExternalAutoProvision(
  enabled: boolean,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.patch("/users/external-auto-provision", {
      enabled,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update OIDC auto-provision");
  }
}

export async function getCredentialStorage(): Promise<{ enabled: boolean }> {
  try {
    const response = await authApi.get("/users/credential-storage");
    return response.data;
  } catch (error) {
    handleApiError(error, "check credential storage setting");
  }
}

export async function updateCredentialStorage(
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  try {
    const response = await authApi.patch("/users/credential-storage", {
      enabled,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update credential storage setting");
  }
}

export async function getHostKeyPolicy(): Promise<{
  trustOnFirstUse: boolean;
}> {
  try {
    const response = await authApi.get("/users/host-key-policy");
    return response.data;
  } catch (error) {
    handleApiError(error, "check host key trust setting");
  }
}

export async function updateHostKeyPolicy(
  trustOnFirstUse: boolean,
): Promise<{ trustOnFirstUse: boolean }> {
  try {
    const response = await authApi.patch("/users/host-key-policy", {
      trustOnFirstUse,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update host key trust setting");
  }
}

export async function getSecondFactorAfterExternalLogin(): Promise<{
  enabled: boolean;
}> {
  try {
    const response = await authApi.get(
      "/users/second-factor-after-external-login",
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "check second factor after external login status");
  }
}

export async function updateSecondFactorAfterExternalLogin(
  enabled: boolean,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.patch(
      "/users/second-factor-after-external-login",
      { enabled },
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "update second factor after external login");
  }
}

export async function updatePasswordLoginAllowed(
  allowed: boolean,
): Promise<{ allowed: boolean }> {
  try {
    const response = await authApi.patch("/users/password-login-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update password login allowed");
  }
}

export async function getPasswordResetAllowed(): Promise<boolean> {
  try {
    const response = await authApi.get("/users/password-reset-allowed");
    return response.data.allowed;
  } catch (error) {
    handleApiError(error, "get password reset allowed");
  }
}

export async function updatePasswordResetAllowed(
  allowed: boolean,
): Promise<{ allowed: boolean }> {
  try {
    const response = await authApi.patch("/users/password-reset-allowed", {
      allowed,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update password reset allowed");
  }
}

// ============================================================================
