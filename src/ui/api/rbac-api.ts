import { handleApiError, rbacApi } from "@/main-axios";
import type { AccessRecord, Role, UserRole } from "@/main-axios";

export async function getRoles(): Promise<{ roles: Role[] }> {
  try {
    const response = await rbacApi.get("/rbac/roles");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch roles");
  }
}

export async function createRole(roleData: {
  name: string;
  displayName: string;
  description?: string | null;
}): Promise<{ role: Role }> {
  try {
    const response = await rbacApi.post("/rbac/roles", roleData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create role");
  }
}

export async function updateRole(
  roleId: number,
  roleData: {
    displayName?: string;
    description?: string | null;
  },
): Promise<{ role: Role }> {
  try {
    const response = await rbacApi.put(`/rbac/roles/${roleId}`, roleData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update role");
  }
}

export async function deleteRole(
  roleId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.delete(`/rbac/roles/${roleId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete role");
  }
}

export async function getUserRoles(
  userId: string,
): Promise<{ roles: UserRole[] }> {
  try {
    const response = await rbacApi.get(`/rbac/users/${userId}/roles`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch user roles");
  }
}

export async function assignRoleToUser(
  userId: string,
  roleId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.post(`/rbac/users/${userId}/roles`, {
      roleId,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "assign role to user");
  }
}

export async function removeRoleFromUser(
  userId: string,
  roleId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.delete(
      `/rbac/users/${userId}/roles/${roleId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "remove role from user");
  }
}

export async function shareHost(
  hostId: number,
  shareData: {
    targetType: "user" | "role";
    targetUserId?: string;
    targetRoleId?: number;
    permissionLevel: "view";
    durationHours?: number;
  },
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.post(
      `/rbac/host/${hostId}/share`,
      shareData,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "share host");
  }
}

export async function getHostAccess(
  hostId: number,
): Promise<{ accessList: AccessRecord[] }> {
  try {
    const response = await rbacApi.get(`/rbac/host/${hostId}/access`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch host access");
  }
}

export async function revokeHostAccess(
  hostId: number,
  accessId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.delete(
      `/rbac/host/${hostId}/access/${accessId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "revoke host access");
  }
}

// ============================================================================
// SNIPPET SHARING
// ============================================================================

export async function shareSnippet(
  snippetId: number,
  shareData: {
    targetType: "user" | "role";
    targetUserId?: string;
    targetRoleId?: number;
    durationHours?: number;
  },
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.post(
      `/rbac/snippet/${snippetId}/share`,
      shareData,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "share snippet");
  }
}

export async function getSnippetAccess(
  snippetId: number,
): Promise<{ accessList: AccessRecord[] }> {
  try {
    const response = await rbacApi.get(`/rbac/snippet/${snippetId}/access`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch snippet access");
  }
}

export async function revokeSnippetAccess(
  snippetId: number,
  accessId: number,
): Promise<{ success: boolean }> {
  try {
    const response = await rbacApi.delete(
      `/rbac/snippet/${snippetId}/access/${accessId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "revoke snippet access");
  }
}

export async function getSharedSnippets(): Promise<{
  sharedSnippets: Array<{
    id: number;
    name: string;
    content: string;
    description: string | null;
    folder: string | null;
    ownerUsername: string;
    permissionLevel: string;
    expiresAt: string | null;
  }>;
}> {
  try {
    const response = await rbacApi.get("/rbac/shared-snippets");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch shared snippets");
  }
}
