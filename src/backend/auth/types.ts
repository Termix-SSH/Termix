import type { PluginVerifiedIdentity } from "@termix/plugin-sdk/backend";

export { LoginMethodError } from "@termix/plugin-sdk/backend";

/** Extra fields core's own methods may set. Plugins never see these. */
interface CoreIdentityExtras {
  /**
   * The identifier string the user row carried before user_external_identities
   * existed ("ldap:<provider>:<id>", "github:<provider>:<id>" or a bare OIDC
   * subject). Found users get their identity row linked lazily; new users keep
   * the column filled so older code that reads it still works.
   */
  legacyIdentifier?: string;
  /** SSO provider row the session came from, for back-channel logout. */
  ssoProviderId?: number | null;
  oidcSub?: string | null;
  oidcSid?: string | null;
  /** Provider group to role mapping, applied on every login. */
  roleSync?: { desired: string[]; managed: string[] };
  /** Shown when the user's data key cannot be unlocked by this method. */
  unlockError?: string;
  /** Username the login rate limiter counted, cleared on success. */
  rateLimitUsername?: string;
}

export type VerifiedIdentity = PluginVerifiedIdentity & CoreIdentityExtras;

/** What a login needs to remember while it waits for a second factor. */
export interface PendingLogin {
  userId: string;
  methodId: string;
  rememberMe: boolean;
  ssoProviderId?: number | null;
  oidcSub?: string | null;
  oidcSid?: string | null;
  createdAt: number;
}
