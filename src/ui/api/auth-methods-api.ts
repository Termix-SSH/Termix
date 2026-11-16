import {
  authApi,
  handleApiError,
  markUserAuthenticated,
  TRUST_TOKEN_KEY,
  type AuthResponse,
} from "@/main-axios";

/** A field the login screen draws for a plugin's method or factor. */
export interface LoginField {
  name: string;
  type: "text" | "password" | "code";
  labelKey: string;
  autocomplete?: string;
}

export type SecondFactorPrompt =
  | { kind: "code"; field?: string; labelKey?: string; length?: number }
  | { kind: "fields"; fields: LoginField[] }
  | { kind: "webauthn" };

export interface PublicLoginMethod {
  id: string;
  pluginId: string;
  kind: "redirect" | "form" | "webauthn";
  labelKey: string;
  icon?: string;
  fields?: LoginField[];
  placement?: "inline";
  instances: Array<{
    id: string;
    label: string;
    autoStart?: boolean;
    views?: Array<"password" | "external">;
  }>;
}

export interface SecondFactorRef {
  id: string;
  pluginId: string;
  labelKey: string;
  prompt?: SecondFactorPrompt;
}

/** Options for the browser's WebAuthn prompt, from a plugin's backend. */
export interface WebAuthnStart {
  publicKey: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export type LoginResponse = AuthResponse & {
  requires_second_factor?: boolean;
  second_factors?: SecondFactorRef[];
  userId?: string;
};

function remember(
  data: LoginResponse & { trustToken?: string },
): LoginResponse {
  if (data?.token) localStorage.setItem("jwt", data.token);
  if (data?.trustToken) localStorage.setItem(TRUST_TOKEN_KEY, data.trustToken);
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

/** Every second factor with how to ask for it. Public. */
export async function getPublicSecondFactors(): Promise<SecondFactorRef[]> {
  try {
    const response = await authApi.get("/users/auth/methods");
    return Array.isArray(response.data?.secondFactors)
      ? response.data.secondFactors
      : [];
  } catch {
    return [];
  }
}

/** A passkey method's options for the browser prompt. Public. */
export async function getWebAuthnLoginOptions(
  methodId: string,
  instanceId?: string,
  username?: string,
): Promise<WebAuthnStart> {
  try {
    const response = await authApi.post(
      `/users/auth/${encodeURIComponent(methodId)}/options`,
      { instanceId, ...(username ? { username } : {}) },
    );
    return response.data as WebAuthnStart;
  } catch (error) {
    throw handleApiError(error, "start passkey login");
  }
}

/** Starts a WebAuthn step one of a plugin's screens asked for. */
export async function startPluginCeremony(
  pluginId: string,
  ceremonyId: string,
  extra: Record<string, unknown>,
): Promise<{
  ticket: string;
  type: "create" | "get";
  publicKey: Record<string, unknown>;
}> {
  const response = await authApi.post(
    `/plugins/${encodeURIComponent(pluginId)}/passkey-steps/${encodeURIComponent(ceremonyId)}/options`,
    { extra },
  );
  return response.data;
}

/** Finishes it; the answer is whatever the plugin's backend returned. */
export async function finishPluginCeremony(
  pluginId: string,
  ceremonyId: string,
  ticket: string,
  response: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await authApi.post(
    `/plugins/${encodeURIComponent(pluginId)}/passkey-steps/${encodeURIComponent(ceremonyId)}/finish`,
    { ticket, response },
  );
  return (result.data ?? {}) as Record<string, unknown>;
}

/** False when the login policy turned remember me off. Public. */
export async function getRememberDeviceAllowed(): Promise<boolean> {
  try {
    const response = await authApi.get("/users/auth/methods");
    return response.data?.rememberDevice !== false;
  } catch {
    return true;
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

/** The second factors the signed in user can prove. */
export async function listStepUpFactors(): Promise<SecondFactorRef[]> {
  try {
    const response = await authApi.get("/users/auth/step-up/factors");
    return response.data?.factors ?? [];
  } catch (error) {
    throw handleApiError(error, "list second factors");
  }
}

export async function challengeStepUp(factorId: string): Promise<unknown> {
  const response = await authApi.post(
    `/users/auth/step-up/${encodeURIComponent(factorId)}/challenge`,
    {},
  );
  return response.data?.challenge ?? null;
}

/** Throws when the answer is wrong. */
export async function verifyStepUp(
  factorId: string,
  body: Record<string, unknown>,
): Promise<void> {
  try {
    await authApi.post(
      `/users/auth/step-up/${encodeURIComponent(factorId)}/verify`,
      body,
    );
  } catch (error) {
    throw handleApiError(error, "verify second factor");
  }
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
