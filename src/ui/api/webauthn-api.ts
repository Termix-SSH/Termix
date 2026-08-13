import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { startRegistration } from "@simplewebauthn/browser";
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
