import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { authApi, handleApiError } from "@/main-axios";

export type WebAuthnUserVerification = "discouraged" | "preferred" | "required";

export type WebAuthnCredentialSummary = {
  id: string;
  name: string;
  deviceType?: string | null;
  backedUp: boolean;
  transports: string[];
  userVerification: WebAuthnUserVerification;
  createdAt: string;
  lastUsedAt?: string | null;
};

type RegistrationOptionsResponse = {
  options: PublicKeyCredentialCreationOptionsJSON;
  challengeId: string;
};

type AuthenticationOptionsResponse = {
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeId: string;
};

export type PasskeyLoginResult = {
  success: boolean;
  requires_totp?: boolean;
  temp_token?: string;
  is_admin?: boolean;
  username?: string;
  userId?: string;
  is_oidc?: boolean;
  totp_enabled?: boolean;
  token?: string;
};

export function isPasskeySupported(): boolean {
  return browserSupportsWebAuthn();
}

export async function loginWithPasskey(
  username?: string,
  rememberMe = false,
): Promise<PasskeyLoginResult> {
  try {
    const optionsResponse = await authApi.post<AuthenticationOptionsResponse>(
      "/users/webauthn/authenticate/options",
      username ? { username } : {},
    );
    const credential = await startAuthentication({
      optionsJSON: optionsResponse.data.options,
    });
    const verifyResponse = await authApi.post<PasskeyLoginResult>(
      "/users/webauthn/authenticate/verify",
      {
        challengeId: optionsResponse.data.challengeId,
        response: credential as AuthenticationResponseJSON,
        rememberMe,
      },
    );
    return verifyResponse.data;
  } catch (error) {
    throw handleApiError(error, "sign in with passkey");
  }
}

export async function listWebAuthnCredentials(): Promise<{
  credentials: WebAuthnCredentialSummary[];
}> {
  try {
    const response = await authApi.get("/users/webauthn/credentials");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "list passkeys");
  }
}

export async function registerWebAuthnCredential(
  name: string,
  userVerification: WebAuthnUserVerification,
): Promise<{ success: boolean }> {
  try {
    const optionsResponse = await authApi.post<RegistrationOptionsResponse>(
      "/users/webauthn/register/options",
      { userVerification },
    );
    const credential = await startRegistration({
      optionsJSON: optionsResponse.data.options,
    });
    const verifyResponse = await authApi.post(
      "/users/webauthn/register/verify",
      {
        challengeId: optionsResponse.data.challengeId,
        name,
        response: credential as RegistrationResponseJSON,
      },
    );
    return verifyResponse.data;
  } catch (error) {
    throw handleApiError(error, "register passkey");
  }
}

export async function deleteWebAuthnCredential(
  credentialId: string,
): Promise<{ success: boolean }> {
  try {
    const response = await authApi.delete(
      `/users/webauthn/credentials/${credentialId}`,
    );
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete passkey");
  }
}
