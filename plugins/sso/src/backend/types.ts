export type SsoProviderType = "oidc" | "github" | "google";

export const SSO_PROVIDER_TYPES: readonly SsoProviderType[] = [
  "oidc",
  "github",
  "google",
];

export interface OidcConfig {
  client_id: string;
  client_secret: string;
  issuer_url: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string;
  identifier_path: string;
  name_path: string;
  scopes: string;
  allowed_users: string;
  admin_group: string;
  group_claim?: string;
  role_map?: string;
  ca_cert?: string;
}

/** A provider ready to sign someone in: secrets opened, defaults applied. */
export interface ResolvedProvider {
  config: OidcConfig;
  type: SsoProviderType;
  /** The row id, or null for the provider configured through OIDC_* env vars. */
  rowId: number | null;
  /** Sends the 2.8 redirect URI, /users/oidc/callback, which core forwards. */
  legacyCallback: boolean;
}

export interface ProviderRow {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  displayOrder: number;
  config: string;
  legacyCallback: boolean;
  createdAt: string;
  updatedAt: string;
}
