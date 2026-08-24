import {
  handleApiError,
  rbacApi,
  type AccessRecord,
  type Role,
  type UserRole,
} from "@/main-axios";
import type { AuthOverrideProtocol } from "@/types/auth-protocols";
import {
  getConnectedRemoteApi,
  resolveRemoteHostId,
} from "@/lib/remote-server-api";

async function getSharingTarget(hostId: number, syncId?: string | null) {
  const api = await getConnectedRemoteApi();
  if (!api || !syncId) return { api: rbacApi, hostId };
  const remoteHostId = await resolveRemoteHostId(syncId);
  if (remoteHostId === null) {
    throw new Error("The synced host does not exist on the remote server");
  }
  return { api, hostId: remoteHostId };
}

export async function getRoles(): Promise<{ roles: Role[] }> {
  try {
    const api = (await getConnectedRemoteApi()) ?? rbacApi;
    const response = await api.get("/rbac/roles");
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
    permissions?: string[];
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

export interface RoleMember {
  userId: string;
  username: string;
  grantedAt: string;
  grantedBy: string | null;
}

export async function getRoleMembers(
  roleId: number,
): Promise<{ members: RoleMember[] }> {
  try {
    const response = await rbacApi.get(`/rbac/roles/${roleId}/members`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get role members");
  }
}

export type SharePermissionLevel = "connect" | "view" | "edit" | "manage";

export interface ShareTarget {
  type: "user" | "role";
  id: string | number;
}

export async function shareHost(
  hostId: number,
  shareData: {
    targets: ShareTarget[];
    permissionLevel: SharePermissionLevel;
    durationHours?: number;
  },
  syncId?: string | null,
): Promise<{
  success: boolean;
  expiresAt: string | null;
  results: Array<{
    type: "user" | "role";
    id: string | number;
    accessId: number;
    created: boolean;
  }>;
}> {
  try {
    const target = await getSharingTarget(hostId, syncId);
    const response = await target.api.post(
      `/rbac/host/${target.hostId}/share`,
      shareData,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "share host");
  }
}

export async function shareFolder(
  folder: string,
  shareData: {
    targets: ShareTarget[];
    permissionLevel: SharePermissionLevel;
    durationHours?: number;
  },
): Promise<{
  success: boolean;
  expiresAt: string | null;
  hostsShared: number;
  hostsTotal: number;
  hostResults: Array<{ hostId: number; shared: boolean; reason?: string }>;
}> {
  try {
    const api = (await getConnectedRemoteApi()) ?? rbacApi;
    const response = await api.post("/rbac/folder/share", {
      folder,
      ...shareData,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "share folder");
  }
}

export interface FolderAccessRule {
  id: number;
  folder: string;
  targetType: "user" | "role";
  userId: string | null;
  roleId: number | null;
  username: string | null;
  roleName: string | null;
  roleDisplayName: string | null;
  permissionLevel: SharePermissionLevel;
  expiresAt: string | null;
  createdAt: string;
}

/** Standing shares on a folder - what hosts added to it later inherit. */
export async function getFolderAccess(
  folder: string,
): Promise<{ rules: FolderAccessRule[] }> {
  try {
    const response = await rbacApi.get("/rbac/folder/access", {
      params: { folder },
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get folder access");
  }
}

export async function revokeFolderAccess(ruleId: number): Promise<void> {
  try {
    await rbacApi.delete(`/rbac/folder/access/${ruleId}`);
  } catch (error) {
    throw handleApiError(error, "revoke folder access");
  }
}

export async function updateHostAccess(
  hostId: number,
  accessId: number,
  update: {
    permissionLevel?: SharePermissionLevel;
    durationHours?: number | null;
  },
  syncId?: string | null,
): Promise<{ success: boolean; expiresAt: string | null }> {
  try {
    const target = await getSharingTarget(hostId, syncId);
    const response = await target.api.patch(
      `/rbac/host/${target.hostId}/access/${accessId}`,
      update,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update host access");
  }
}

export async function getHostAccess(
  hostId: number,
  syncId?: string | null,
): Promise<{ accessList: AccessRecord[]; isOwner?: boolean }> {
  try {
    const target = await getSharingTarget(hostId, syncId);
    const response = await target.api.get(`/rbac/host/${target.hostId}/access`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch host access");
  }
}

export interface PermissionCatalogEntry {
  group: string;
  permissions: string[];
}

export async function getPermissionsCatalog(): Promise<{
  catalog: PermissionCatalogEntry[];
}> {
  try {
    const response = await rbacApi.get("/rbac/permissions/catalog");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch permissions catalog");
  }
}

export async function getSharedHosts(): Promise<{
  sharedHosts: Array<{
    id: number;
    name: string | null;
    ip: string;
    port: number;
    username: string;
    folder: string | null;
    tags: string | null;
    permissionLevel: SharePermissionLevel;
    expiresAt: string | null;
    grantedBy: string;
    ownerUsername: string;
  }>;
}> {
  try {
    const api = (await getConnectedRemoteApi()) ?? rbacApi;
    const response = await api.get("/rbac/shared-hosts");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch shared hosts");
  }
}

export async function revokeHostAccess(
  hostId: number,
  accessId: number,
  syncId?: string | null,
): Promise<{ success: boolean }> {
  try {
    const target = await getSharingTarget(hostId, syncId);
    const response = await target.api.delete(
      `/rbac/host/${target.hostId}/access/${accessId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "revoke host access");
  }
}

export async function getHostAuthOverride(
  hostId: number,
  protocol: AuthOverrideProtocol,
): Promise<{ protocol: AuthOverrideProtocol; credentialId: number | null }> {
  try {
    const response = await rbacApi.get(
      `/rbac/host-access/${hostId}/auth/${protocol}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch host authentication override");
  }
}

export async function setHostAuthOverride(
  hostId: number,
  protocol: AuthOverrideProtocol,
  credentialId: number | null,
): Promise<{
  success: boolean;
  protocol: AuthOverrideProtocol;
  credentialId: number | null;
}> {
  try {
    const response = await rbacApi.put(
      `/rbac/host-access/${hostId}/auth/${protocol}`,
      { credentialId },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update host authentication override");
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

export async function shareSnippetFolder(
  folder: string,
  targets: ShareTarget[],
  durationHours?: number,
): Promise<{ success: boolean; snippetsShared: number }> {
  try {
    const response = await rbacApi.post("/rbac/snippet-folder/share", {
      folder,
      targets,
      durationHours,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "share snippet folder");
  }
}

export type CredentialPermissionLevel = "use" | "manage";

export async function shareCredential(
  credentialId: number,
  targets: ShareTarget[],
  permissionLevel: CredentialPermissionLevel,
  durationHours?: number,
): Promise<{ success: boolean; expiresAt: string | null }> {
  try {
    const response = await rbacApi.post(
      `/rbac/credential/${credentialId}/share`,
      { targets, permissionLevel, durationHours },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "share credential");
  }
}

export async function getCredentialAccess(
  credentialId: number,
): Promise<{ access: AccessRecord[] }> {
  try {
    const response = await rbacApi.get(
      `/rbac/credential/${credentialId}/access`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "get credential access");
  }
}

export async function revokeCredentialAccess(
  credentialId: number,
  accessId: number,
): Promise<void> {
  try {
    await rbacApi.delete(`/rbac/credential/${credentialId}/access/${accessId}`);
  } catch (error) {
    throw handleApiError(error, "revoke credential access");
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
