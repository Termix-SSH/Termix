import { authApi, handleApiError } from "@/main-axios";

// ACCOUNTS, INVITES AND ACCESS REVIEW
// ============================================================================

export type UserStatusFilter = "active" | "disabled" | "pending";

export async function disableUser(
  userId: string,
): Promise<{ disabled: boolean }> {
  try {
    const response = await authApi.post(
      `/users/admin/${encodeURIComponent(userId)}/disable`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "turn off account");
  }
}

/** Turns an account back on, or approves one waiting for approval. */
export async function enableUser(
  userId: string,
): Promise<{ disabled: boolean }> {
  try {
    const response = await authApi.post(
      `/users/admin/${encodeURIComponent(userId)}/enable`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "turn on account");
  }
}

export interface UserProfile {
  userId: string;
  username: string;
  display_name: string | null;
  email: string | null;
}

export interface UserProfileUpdate {
  displayName?: string | null;
  email?: string | null;
}

export async function updateMyProfile(
  update: UserProfileUpdate,
): Promise<UserProfile> {
  try {
    const response = await authApi.patch("/users/me/profile", update);
    return response.data;
  } catch (error) {
    handleApiError(error, "save profile");
  }
}

export async function adminUpdateUserProfile(
  userId: string,
  update: UserProfileUpdate,
): Promise<UserProfile> {
  try {
    const response = await authApi.patch(
      `/users/admin/${encodeURIComponent(userId)}/profile`,
      update,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "save profile");
  }
}

export async function getAdminHostBypass(): Promise<{ enabled: boolean }> {
  try {
    const response = await authApi.get("/users/admin-host-bypass");
    return response.data;
  } catch (error) {
    handleApiError(error, "check admin host access");
  }
}

/** May answer with an admin hold ticket when turning it on has to wait. */
export async function updateAdminHostBypass(
  enabled: boolean,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.patch("/users/admin-host-bypass", {
      enabled,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "save admin host access");
  }
}

export async function getExternalSignupApproval(): Promise<{
  enabled: boolean;
}> {
  try {
    const response = await authApi.get("/users/external-signup-approval");
    return response.data;
  } catch (error) {
    handleApiError(error, "check signup approval");
  }
}

export async function updateExternalSignupApproval(
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  try {
    const response = await authApi.patch("/users/external-signup-approval", {
      enabled,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "save signup approval");
  }
}

export interface UserInvite {
  id: string;
  note: string | null;
  roleIds: number[];
  makeAdmin: boolean;
  maxUses: number;
  uses: number;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  state: "active" | "revoked" | "expired" | "used";
}

export interface NewUserInvite {
  note?: string;
  roleIds?: number[];
  makeAdmin?: boolean;
  maxUses?: number;
  expiresInHours?: number;
}

export interface CreatedUserInvite {
  id: string;
  /** Shown only once. */
  token: string;
  expiresAt: string;
  maxUses: number;
}

export async function listUserInvites(): Promise<UserInvite[]> {
  try {
    const response = await authApi.get("/users/invites");
    return response.data?.invites ?? [];
  } catch (error) {
    handleApiError(error, "list invites");
  }
}

export async function createUserInvite(
  input: NewUserInvite,
): Promise<CreatedUserInvite> {
  try {
    const response = await authApi.post("/users/invites", input);
    return response.data;
  } catch (error) {
    handleApiError(error, "make invite");
  }
}

export async function revokeUserInvite(id: string): Promise<void> {
  try {
    await authApi.delete(`/users/invites/${encodeURIComponent(id)}`);
  } catch (error) {
    handleApiError(error, "revoke invite");
  }
}

export async function checkUserInvite(
  token: string,
): Promise<{ valid: boolean; state: string }> {
  try {
    const response = await authApi.get(
      `/users/invites/redeem/${encodeURIComponent(token)}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "check invite");
  }
}

export async function acceptUserInvite(
  token: string,
  username: string,
  password: string,
): Promise<{ userId: string }> {
  try {
    const response = await authApi.post(
      `/users/invites/redeem/${encodeURIComponent(token)}/accept`,
      { username, password },
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "accept invite");
  }
}

/** The link someone opens to use an invite. */
export function inviteLink(token: string): string {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = `?invite=${encodeURIComponent(token)}`;
  return url.toString();
}

export type AccessKind = "host" | "folder" | "credential";

export interface AccessReviewRow {
  kind: AccessKind;
  accessId: number;
  targetId: string;
  targetName: string;
  ownerId: string | null;
  ownerUsername: string | null;
  granteeUserId: string | null;
  granteeUsername: string | null;
  granteeRoleId: number | null;
  granteeRoleName: string | null;
  permissionLevel: string;
  grantedBy: string | null;
  grantedByUsername: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastAccessedAt: string | null;
}

export interface AccessReviewFilter {
  kind?: AccessKind;
  userId?: string;
  roleId?: number;
  limit?: number;
  offset?: number;
}

export async function getAccessReview(
  filter: AccessReviewFilter = {},
): Promise<{ shares: AccessReviewRow[]; total: number }> {
  try {
    const response = await authApi.get("/rbac/access-review", {
      params: filter,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "list shares");
  }
}

export async function downloadAccessReviewCsv(
  filter: AccessReviewFilter = {},
): Promise<Blob> {
  try {
    const response = await authApi.get("/rbac/access-review", {
      params: { ...filter, format: "csv" },
      responseType: "blob",
    });
    return response.data as Blob;
  } catch (error) {
    handleApiError(error, "export shares");
  }
}
