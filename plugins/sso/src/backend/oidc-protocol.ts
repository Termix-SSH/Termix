/**
 * OpenID Connect protocol helpers: token verification, groups and the role
 * map, back-channel logout tokens and the provider defaults. Nothing here
 * touches storage.
 */

import crypto from "node:crypto";
import { Agent } from "undici";
import type { OidcConfig } from "./types.js";

const BACKCHANNEL_LOGOUT_EVENT =
  "http://schemas.openid.net/event/backchannel-logout";

/**
 * Raised when a token cannot be verified because it is not a compact JWS,
 * as opposed to a signature or claim check that actually failed.
 */
export class OIDCTokenFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OIDCTokenFormatError";
  }
}

export function normalizeIssuer(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/\.well-known\/openid-configuration$/, "");
}

export function buildFetchOptions(caCert?: string): Record<string, unknown> {
  if (!caCert || !caCert.trim()) return {};
  return { dispatcher: new Agent({ connect: { ca: caCert } }) };
}

/**
 * Renders why a fetch failed in a form an administrator can act on.
 *
 * undici reports every transport failure as the same "fetch failed" message
 * and puts the reason that actually matters -- ENOTFOUND, ECONNREFUSED,
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE, a timeout -- on the cause. Reporting only
 * the outer message says nothing at all.
 */
export function describeFetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return code
      ? `${error.message}: ${cause.message} (${code})`
      : `${error.message}: ${cause.message}`;
  }
  return cause ? `${error.message}: ${String(cause)}` : error.message;
}

export function getOidcConfigFromEnv(): OidcConfig | null {
  const client_id = process.env.OIDC_CLIENT_ID;
  const client_secret = process.env.OIDC_CLIENT_SECRET;
  const issuer_url = process.env.OIDC_ISSUER_URL;
  const authorization_url = process.env.OIDC_AUTHORIZATION_URL;
  const token_url = process.env.OIDC_TOKEN_URL;

  if (
    !client_id ||
    !client_secret ||
    !issuer_url ||
    !authorization_url ||
    !token_url
  ) {
    return null;
  }

  return {
    client_id,
    client_secret,
    issuer_url,
    authorization_url,
    token_url,
    userinfo_url: process.env.OIDC_USERINFO_URL || "",
    identifier_path: process.env.OIDC_IDENTIFIER_PATH || "sub",
    name_path: process.env.OIDC_NAME_PATH || "name",
    scopes: process.env.OIDC_SCOPES || "openid email profile",
    allowed_users: process.env.OIDC_ALLOWED_USERS || "",
    admin_group: process.env.OIDC_ADMIN_GROUP || "",
    group_claim: process.env.OIDC_GROUP_CLAIM || "",
    role_map: process.env.OIDC_ROLE_MAP || "",
  };
}

export function isOIDCEnvOverrideEnabled(): boolean {
  return process.env.OIDC_ENV_OVERRIDE?.toLowerCase() === "true";
}

/**
 * Normalizes a group name for comparison. Providers are inconsistent about
 * whether they emit bare names (`devops-interns`) or full paths
 * (`/devops-interns`, Keycloak's "Full group path" option), so leading slashes
 * are stripped and case is ignored.
 */
function normalizeGroupName(group: string): string {
  return group.trim().replace(/^\/+/, "").toLowerCase();
}

/**
 * Parses `OIDC_ROLE_MAP` into a group -> role-name lookup.
 *
 * Format is a comma- or newline-separated list of `group:role` pairs, e.g.
 * `devops-interns:devops-intern,devops-seniors:devops-senior`. Group keys are
 * normalized via {@link normalizeGroupName}; role names are passed through
 * verbatim because they must match `roles.name` exactly.
 *
 * Malformed entries are skipped rather than throwing - a typo in one pair must
 * not lock every user out of login.
 */
export function parseOidcRoleMap(raw?: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw || !raw.trim()) return map;

  for (const entry of raw.split(/[\n,]/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    // rsplit on the last ":" so group names containing a colon still work.
    const separator = trimmed.lastIndexOf(":");
    if (separator <= 0 || separator === trimmed.length - 1) continue;

    const group = normalizeGroupName(trimmed.slice(0, separator));
    const roleName = trimmed.slice(separator + 1).trim();
    if (!group || !roleName) continue;

    map.set(group, roleName);
  }

  return map;
}

/**
 * Resolves which mapped roles a user should hold, given their provider groups.
 *
 * Returns both the `desired` roles (mapped groups the user is actually in) and
 * the full set of `managed` roles (every role named in the map). Callers must
 * only ever add/remove roles within `managed` - roles assigned by hand in
 * Termix, and the `admin`/`user` roles maintained by the admin-group sync, are
 * deliberately left alone.
 */
export function resolveOidcMappedRoles(
  groups: string[],
  roleMap: Map<string, string>,
): { desired: Set<string>; managed: Set<string> } {
  const managed = new Set(roleMap.values());
  const desired = new Set<string>();

  for (const group of groups) {
    const roleName = roleMap.get(normalizeGroupName(group));
    if (roleName) desired.add(roleName);
  }

  return { desired, managed };
}

/**
 * Extracts the list of group/role names from an OIDC userInfo payload.
 *
 * When `groupClaim` is set, that claim is read first (useful for providers like
 * Zitadel that nest roles under a custom path such as
 * `urn:zitadel:iam:org:project:roles`). Otherwise the common `groups`, `roles`
 * and `group` claims are tried. Values may be an array, a comma-separated
 * string, or an object whose keys are the group names.
 */
export function extractOidcGroups(
  userInfo: Record<string, unknown>,
  groupClaim?: string,
): string[] {
  let raw: unknown;
  if (groupClaim && groupClaim.trim()) {
    raw = userInfo[groupClaim.trim()];
  }
  if (raw === undefined || raw === null) {
    raw = userInfo.groups ?? userInfo.roles ?? userInfo.group;
  }

  if (Array.isArray(raw)) {
    return raw.map(String);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (raw && typeof raw === "object") {
    return Object.keys(raw as Record<string, unknown>);
  }
  return [];
}

/**
 * OIDC providers may return group claims in the ID token, userinfo response,
 * or both. Keep every verified source authoritative instead of letting a
 * sparse userinfo payload overwrite claims from the ID token.
 */
export function extractOidcGroupsFromSources(
  sources: Record<string, unknown>[],
  groupClaim?: string,
): string[] {
  return [
    ...new Set(
      sources.flatMap((source) => extractOidcGroups(source, groupClaim)),
    ),
  ];
}

export async function verifyOIDCToken(
  idToken: string,
  issuerUrl: string,
  clientId: string,
  caCert?: string,
): Promise<Record<string, unknown>> {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new OIDCTokenFormatError(
      segments.length === 5
        ? "Token is a JWE (encrypted). Termix cannot verify encrypted tokens; disable token encryption for this client in your OIDC provider."
        : `Token is not a compact JWS: expected 3 segments, got ${segments.length}.`,
    );
  }

  const fetchOptions = buildFetchOptions(caCert);
  const configuredIssuerUrl = issuerUrl.trim().replace(/\/+$/, "");
  const normalizedIssuerUrl = normalizeIssuer(issuerUrl);
  const possibleIssuers = [
    normalizedIssuerUrl,
    normalizedIssuerUrl.replace(/\/application\/o\/[^/]+$/, ""),
    ...(configuredIssuerUrl === normalizedIssuerUrl ? [issuerUrl] : []),
  ];

  const jwksUrls = [
    `${normalizedIssuerUrl}/.well-known/jwks.json`,
    `${normalizedIssuerUrl}/jwks/`,
    `${normalizedIssuerUrl.replace(/\/application\/o\/[^/]+$/, "")}/.well-known/jwks.json`,
  ];

  // Every attempt records why it failed. Without this the only thing an
  // administrator ever sees is "Failed to fetch JWKS from any URL", which
  // does not distinguish an issuer URL typo from a proxy, a private CA, or
  // a provider outage.
  const attempts: string[] = [];

  const discoveryUrl = `${normalizedIssuerUrl}/.well-known/openid-configuration`;
  try {
    const discoveryResponse = await fetch(discoveryUrl, fetchOptions);
    if (!discoveryResponse.ok) {
      attempts.push(`${discoveryUrl}: HTTP ${discoveryResponse.status}`);
    } else {
      const discovery = (await discoveryResponse.json()) as Record<
        string,
        unknown
      >;
      if (typeof discovery.jwks_uri === "string" && discovery.jwks_uri) {
        jwksUrls.unshift(discovery.jwks_uri);
      } else {
        attempts.push(`${discoveryUrl}: no jwks_uri in the discovery document`);
      }
    }
  } catch (discoveryError) {
    attempts.push(`${discoveryUrl}: ${describeFetchFailure(discoveryError)}`);
  }

  let jwks: Record<string, unknown> | null = null;

  for (const url of jwksUrls) {
    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        attempts.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const jwksData = (await response.json()) as Record<string, unknown>;
      if (jwksData && Array.isArray(jwksData.keys)) {
        jwks = jwksData;
        break;
      }
      attempts.push(`${url}: response contains no "keys" array`);
    } catch (error) {
      attempts.push(`${url}: ${describeFetchFailure(error)}`);
    }
  }

  if (!jwks) {
    throw new Error(
      `Failed to fetch JWKS from any URL. Attempts:\n  ${attempts.join("\n  ")}`,
    );
  }

  if (!jwks.keys || !Array.isArray(jwks.keys)) {
    throw new Error(
      `Invalid JWKS response structure. Expected 'keys' array, got: ${JSON.stringify(jwks)}`,
    );
  }

  const { decodeProtectedHeader, importJWK, jwtVerify } = await import("jose");
  const header = decodeProtectedHeader(idToken);
  const keyId = header.kid;

  const publicKey = jwks.keys.find(
    (key: Record<string, unknown>) => key.kid === keyId,
  );
  if (!publicKey) {
    throw new Error(
      `No matching public key found for key ID: ${keyId}. Available keys: ${jwks.keys.map((k: Record<string, unknown>) => k.kid).join(", ")}`,
    );
  }

  const algorithm =
    typeof publicKey.alg === "string" ? publicKey.alg : header.alg;
  const key = await importJWK(publicKey, algorithm);

  const { payload } = await jwtVerify(idToken, key, {
    issuer: possibleIssuers,
    audience: clientId,
  });

  return payload;
}

const GOOGLE_DEFAULTS = {
  issuer_url: "https://accounts.google.com",
  authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
  token_url: "https://oauth2.googleapis.com/token",
  userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo",
  identifier_path: "sub",
  name_path: "name",
  scopes: "openid email profile",
};

const GITHUB_DEFAULTS = {
  issuer_url: "https://token.actions.githubusercontent.com",
  authorization_url: "https://github.com/login/oauth/authorize",
  token_url: "https://github.com/login/oauth/access_token",
  userinfo_url: "https://api.github.com/user",
  identifier_path: "id",
  name_path: "name",
  scopes: "read:user user:email",
};

export function applyProviderDefaults(
  config: OidcConfig,
  providerType: string,
): OidcConfig {
  const defaults =
    providerType === "google"
      ? GOOGLE_DEFAULTS
      : providerType === "github"
        ? GITHUB_DEFAULTS
        : null;
  if (!defaults) return config;
  return {
    ...config,
    issuer_url: config.issuer_url || defaults.issuer_url,
    authorization_url: config.authorization_url || defaults.authorization_url,
    token_url: config.token_url || defaults.token_url,
    userinfo_url: config.userinfo_url || defaults.userinfo_url,
    identifier_path: config.identifier_path || defaults.identifier_path,
    name_path: config.name_path || defaults.name_path,
    scopes: config.scopes || defaults.scopes,
  };
}

export type LogoutTokenClaims = {
  sub: string | null;
  sid: string | null;
  jti: string;
};

export function validateLogoutTokenClaims(
  payload: Record<string, unknown>,
): LogoutTokenClaims {
  if ("nonce" in payload) {
    throw new Error("logout_token must not contain a nonce claim");
  }

  const event = (payload.events as Record<string, unknown> | undefined)?.[
    BACKCHANNEL_LOGOUT_EVENT
  ];
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("logout_token missing back-channel logout event");
  }

  if (!Number.isInteger(payload.iat)) {
    throw new Error("logout_token missing iat claim");
  }

  const jti = typeof payload.jti === "string" ? payload.jti.trim() : "";
  if (!jti) {
    throw new Error("logout_token missing jti claim");
  }

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  const sid = typeof payload.sid === "string" ? payload.sid : null;
  if (!sub && !sid) {
    throw new Error("logout_token must contain sub and/or sid");
  }

  return { sub, sid, jti };
}

export async function validateLogoutToken(
  logoutToken: string,
  config: OidcConfig,
): Promise<LogoutTokenClaims> {
  const payload = await verifyOIDCToken(
    logoutToken,
    config.issuer_url,
    config.client_id,
    config.ca_cert,
  );

  return validateLogoutTokenClaims(payload);
}

export function isValidOidcIssuer(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !/\/userinfo\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  if (!path || !obj) return null;
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) => (current as Record<string, unknown>)?.[key],
      obj,
    );
}

// RFC 7636 PKCE: 43-128 char unreserved-character string.
export function generatePkceCodeVerifier(): string {
  return crypto.randomBytes(64).toString("base64url");
}

export function generatePkceCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

/** The desktop app's loopback listener for a callback port it sent. */
export function getDesktopCallbackUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `http://localhost:${port}/oidc-callback`;
}
