import {
  authApi,
  handleApiError,
  markUserAuthenticated,
  type AuthResponse,
} from "@/main-axios";

export interface PublicLoginMethod {
  id: string;
  pluginId: string;
  kind: "redirect" | "form";
  labelKey: string;
  icon?: string;
  instances: Array<{ id: string; label: string }>;
}

export interface SecondFactorRef {
  id: string;
  pluginId: string;
  labelKey: string;
}

export type LoginResponse = AuthResponse & {
  requires_second_factor?: boolean;
  second_factors?: SecondFactorRef[];
  userId?: string;
};

function remember(data: LoginResponse): LoginResponse {
  if (data?.token) localStorage.setItem("jwt", data.token);
  if (data?.success && !data.requires_totp) markUserAuthenticated();
  return data;
}

/** Enabled login methods for the login screen. Public. */
export async function getLoginMethods(): Promise<PublicLoginMethod[]> {
  try {
    const response = await authApi.get("/users/auth/methods");
    return Array.isArray(response.data?.methods) ? response.data.methods : [];
  } catch {
    return [];
  }
}

export async function submitLoginMethod(
  methodId: string,
  body: Record<string, unknown>,
  instanceId?: string,
): Promise<LoginResponse> {
  try {
    const response = await authApi.post(
      `/users/auth/${encodeURIComponent(methodId)}/verify`,
      { ...body, instanceId },
    );
    return remember(response.data);
  } catch (error) {
    throw handleApiError(error, "login");
  }
}

export async function startLoginRedirect(
  methodId: string,
  params: {
    instanceId?: string;
    rememberMe?: boolean;
    desktopCallbackPort?: number;
  },
): Promise<string> {
  try {
    const response = await authApi.get(
      `/users/auth/${encodeURIComponent(methodId)}/start`,
      {
        params: {
          instance: params.instanceId,
          rememberMe: params.rememberMe,
          desktopCallbackPort: params.desktopCallbackPort,
        },
      },
    );
    return response.data?.redirectUrl as string;
  } catch (error) {
    throw handleApiError(error, "start login");
  }
}

/**
 * Answers a second factor. With no temp token the server reads the pending
 * login cookie a redirect method left.
 */
export async function verifySecondFactor(
  factorId: string,
  body: Record<string, unknown>,
): Promise<LoginResponse> {
  try {
    const response = await authApi.post(
      `/users/auth/second-factor/${encodeURIComponent(factorId)}/verify`,
      body,
    );
    return remember(response.data);
  } catch (error) {
    throw handleApiError(error, "verify second factor");
  }
}

export async function challengeSecondFactor(
  factorId: string,
  tempToken?: string,
): Promise<unknown> {
  const response = await authApi.post(
    `/users/auth/second-factor/${encodeURIComponent(factorId)}/challenge`,
    { temp_token: tempToken },
  );
  return response.data?.challenge ?? null;
}

export interface UserSecondFactorSummary {
  pluginId: string;
  factorId: string;
  labelKey: string | null;
  available: boolean;
}

export async function getUserSecondFactors(
  userId: string,
): Promise<UserSecondFactorSummary[]> {
  try {
    const response = await authApi.get(
      `/users/admin/${encodeURIComponent(userId)}/second-factors`,
    );
    return response.data?.factors ?? [];
  } catch (error) {
    handleApiError(error, "list second factors");
    return [];
  }
}

export async function resetUserSecondFactors(userId: string): Promise<void> {
  try {
    await authApi.delete(
      `/users/admin/${encodeURIComponent(userId)}/second-factors`,
    );
  } catch (error) {
    throw handleApiError(error, "reset second factors");
  }
}

export interface SshAuthProviderSummary {
  type: string;
  labelKey: string;
  descriptionKey?: string;
  pluginId: string;
  fields: Array<Record<string, unknown>>;
  credentialType: boolean;
  needsUserInteraction: boolean;
  supportsBackground: boolean;
  /** Offered in Quick Connect, for a host that is never saved. */
  quickConnect?: boolean;
  available: boolean;
  missingPlugin?: { id: string; name: string };
}

export async function getSshAuthProviders(): Promise<SshAuthProviderSummary[]> {
  try {
    const response = await authApi.get("/ssh-auth/providers");
    return Array.isArray(response.data?.providers)
      ? response.data.providers
      : [];
  } catch {
    return [];
  }
}
