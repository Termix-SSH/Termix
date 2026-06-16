import { authApi, handleApiError } from "@/main-axios";
import type { SSOProvider, SSOProviderPublic } from "@/types/index";

export async function getSSOProviders(): Promise<SSOProviderPublic[]> {
  try {
    const response = await authApi.get("/users/sso-providers");
    return response.data;
  } catch (error: unknown) {
    console.warn("Failed to fetch SSO providers:", error);
    return [];
  }
}

export async function getAdminSSOProviders(): Promise<SSOProvider[]> {
  try {
    const response = await authApi.get("/users/sso-providers/admin");
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    handleApiError(error, "fetch admin SSO providers");
    return [];
  }
}

export async function createSSOProvider(
  data: Omit<SSOProvider, "id" | "createdAt" | "updatedAt"> & {
    config: Record<string, unknown>;
  },
): Promise<SSOProvider> {
  try {
    const response = await authApi.post("/users/sso-providers", data);
    return response.data;
  } catch (error) {
    handleApiError(error, "create SSO provider");
  }
}

export async function updateSSOProvider(
  id: number,
  data: Partial<Omit<SSOProvider, "id" | "createdAt" | "updatedAt">> & {
    config?: Record<string, unknown>;
  },
): Promise<SSOProvider> {
  try {
    const response = await authApi.put(`/users/sso-providers/${id}`, data);
    return response.data;
  } catch (error) {
    handleApiError(error, "update SSO provider");
  }
}

export async function deleteSSOProvider(id: number): Promise<void> {
  try {
    await authApi.delete(`/users/sso-providers/${id}`);
  } catch (error) {
    handleApiError(error, "delete SSO provider");
  }
}

export async function ldapLogin(
  providerId: number,
  username: string,
  password: string,
  rememberMe: boolean,
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authApi.post("/users/ldap/login", {
      providerId,
      username,
      password,
      rememberMe,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "LDAP login");
  }
}
