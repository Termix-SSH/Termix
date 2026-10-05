import type { PluginVerifiedIdentity } from "@termix/plugin-sdk/backend";

export { LoginMethodError } from "@termix/plugin-sdk/backend";

/** The logout claims a login carried, stored as sessions.external_session_ref. */
export interface ExternalSessionRef {
  providerId?: number | null;
  sub?: string | null;
  sid?: string | null;
}

/** Extra fields core's own methods may set. Plugins never see these. */
interface CoreIdentityExtras {
  /**
   * The identifier a 2.8 install kept for the user ("ldap:<provider>:<id>",
   * "github:<provider>:<id>" or a bare OIDC subject). Only checked against
   * the allowed-users list.
   */
  legacyIdentifier?: string;
  /** Kept on the session for an identity provider's back-channel logout. */
  externalSession?: ExternalSessionRef | null;
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
  externalSession?: ExternalSessionRef | null;
  createdAt: number;
}
