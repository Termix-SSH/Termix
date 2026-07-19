import { authApi, handleApiError, sshHostApi } from "@/main-axios";
import type { SSHHost, SSHHostData } from "@/types/index";

// ADMIN USER DATA MANAGEMENT
// ============================================================================
// Wrappers over the regular data-plane endpoints that act on another user's
// data via the X-Admin-Target-User header (admin only, audited server-side).
// They intentionally bypass the host request caches: the data belongs to the
// target user, not the signed-in admin.

const ADMIN_TARGET_USER_HEADER = "X-Admin-Target-User";

function adminHeaders(targetUserId: string): Record<string, string> {
  return { [ADMIN_TARGET_USER_HEADER]: targetUserId };
}

export async function adminGetUserHosts(
  targetUserId: string,
): Promise<SSHHost[]> {
  try {
    const response = await sshHostApi.get("/db/host", {
      headers: adminHeaders(targetUserId),
    });
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    throw handleApiError(error, "fetch user's hosts");
  }
}

export async function adminCreateUserHost(
  targetUserId: string,
  hostData: SSHHostData,
): Promise<SSHHost> {
  try {
    if (hostData.authType === "key" && hostData.key instanceof File) {
      const formData = new FormData();
      formData.append("key", hostData.key);
      const dataWithoutFile = { ...hostData, key: undefined };
      formData.append("data", JSON.stringify(dataWithoutFile));
      const response = await sshHostApi.post("/db/host", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          ...adminHeaders(targetUserId),
        },
      });
      return response.data;
    }
    const response = await sshHostApi.post("/db/host", hostData, {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create host for user");
  }
}

export async function adminUpdateUserHost(
  targetUserId: string,
  hostId: number,
  hostData: SSHHostData,
): Promise<SSHHost> {
  try {
    if (hostData.authType === "key" && hostData.key instanceof File) {
      const formData = new FormData();
      formData.append("key", hostData.key);
      const dataWithoutFile = { ...hostData, key: undefined };
      formData.append("data", JSON.stringify(dataWithoutFile));
      const response = await sshHostApi.put(`/db/host/${hostId}`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          ...adminHeaders(targetUserId),
        },
      });
      return response.data;
    }
    const response = await sshHostApi.put(`/db/host/${hostId}`, hostData, {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update user's host");
  }
}

export async function adminDeleteUserHost(
  targetUserId: string,
  hostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete(`/db/host/${hostId}`, {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete user's host");
  }
}

export async function adminGetHostPassword(
  targetUserId: string,
  hostId: number,
  field: "password" | "sudoPassword" | "vncPassword" = "password",
): Promise<string | null> {
  try {
    const response = await sshHostApi.get(
      `/db/host/${hostId}/password?field=${field}`,
      { headers: adminHeaders(targetUserId) },
    );
    return response.data?.value || null;
  } catch {
    return null;
  }
}

export async function adminGetUserCredentials(
  targetUserId: string,
): Promise<Record<string, unknown>[] | Record<string, unknown>> {
  try {
    const response = await authApi.get("/credentials", {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch user's credentials");
  }
}

export async function adminGetUserCredentialDetails(
  targetUserId: string,
  credentialId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get(`/credentials/${credentialId}`, {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch user's credential details");
  }
}

export async function adminCreateUserCredential(
  targetUserId: string,
  credentialData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/credentials", credentialData, {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create credential for user");
  }
}

export async function adminUpdateUserCredential(
  targetUserId: string,
  credentialId: number,
  credentialData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.put(
      `/credentials/${credentialId}`,
      credentialData,
      { headers: adminHeaders(targetUserId) },
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update user's credential");
  }
}

export async function adminDeleteUserCredential(
  targetUserId: string,
  credentialId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete(`/credentials/${credentialId}`, {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete user's credential");
  }
}

export async function adminGetUserSnippets(
  targetUserId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/snippets", {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch user's snippets");
  }
}

export async function adminCreateUserSnippet(
  targetUserId: string,
  snippetData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/snippets", snippetData, {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create snippet for user");
  }
}

export async function adminUpdateUserSnippet(
  targetUserId: string,
  snippetId: number,
  snippetData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.put(`/snippets/${snippetId}`, snippetData, {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update user's snippet");
  }
}

export async function adminDeleteUserSnippet(
  targetUserId: string,
  snippetId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete(`/snippets/${snippetId}`, {
      headers: adminHeaders(targetUserId),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete user's snippet");
  }
}
