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
import type { PluginApiClient } from "@termix/plugin-sdk/frontend";

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

type OptionsResponse<T> = { options: T; challengeId: string };

export function isPasskeySupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

export function createWebAuthnApi(api: PluginApiClient) {
  return {
    /**
     * Runs the browser ceremony and returns the body for the login method's
     * verify step. Without a username, discoverable passkeys still work.
     */
    async passkeyAssertion(username?: string) {
      const { data } = await api.post<
        OptionsResponse<PublicKeyCredentialRequestOptionsJSON>
      >("authenticate/options", username ? { username } : {});
      const response = await startAuthentication({
        optionsJSON: data.options,
      });
      return {
        challengeId: data.challengeId,
        response: response as AuthenticationResponseJSON,
      };
    },

    async list(): Promise<WebAuthnCredentialSummary[]> {
      const { data } = await api.get<{
        credentials?: WebAuthnCredentialSummary[];
      }>("credentials");
      return data.credentials ?? [];
    },

    async register(
      name: string,
      userVerification: WebAuthnUserVerification,
    ): Promise<void> {
      const { data } = await api.post<
        OptionsResponse<PublicKeyCredentialCreationOptionsJSON>
      >("register/options", { userVerification });
      const response = await startRegistration({ optionsJSON: data.options });
      await api.post("register/verify", {
        challengeId: data.challengeId,
        name,
        response: response as RegistrationResponseJSON,
      });
    },

    async remove(id: string): Promise<void> {
      await api.delete(`credentials/${encodeURIComponent(id)}`);
    },
  };
}
