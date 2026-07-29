import { authLogger } from "../../utils/logger.js";
import type { SSOProviderType } from "../../../types/index.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { decryptSsoConfigSecrets } from "../../utils/system-secret-crypto.js";
import { Agent } from "undici";
import {
  createCurrentSettingsRepository,
  createCurrentSsoProviderRepository,
} from "../repositories/factory.js";

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

function normalizeIssuer(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export type OIDCConfig = {
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
  ca_cert?: string;
};

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

export function getOIDCConfigFromEnv(): OIDCConfig | null {
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
  };
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

export function isOIDCUserAllowed(
  allowedUsers: string,
  identifier: string,
  email?: string,
): boolean {
  if (!allowedUsers || !allowedUsers.trim()) return true;
  const patterns = allowedUsers
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (patterns.length === 0) return true;

  const values = [
    identifier,
    ...(email && email !== identifier ? [email] : []),
  ];
  for (const pattern of patterns) {
    if (pattern === "*") return true;
    if (pattern.includes("*")) {
      const escaped = pattern
        .toLowerCase()
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      const regex = new RegExp(`^${escaped}$`);
      if (values.some((v) => v && regex.test(v.toLowerCase()))) return true;
      continue;
    }
    for (const value of values) {
      if (!value) continue;
      if (pattern.toLowerCase().startsWith("@")) {
        if (value.toLowerCase().endsWith(pattern.toLowerCase())) return true;
      } else {
        if (value.toLowerCase() === pattern.toLowerCase()) return true;
      }
    }
  }
  return false;
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
  const normalizedIssuerUrl = issuerUrl.endsWith("/")
    ? issuerUrl.slice(0, -1)
    : issuerUrl;
  const possibleIssuers = [
    issuerUrl,
    normalizedIssuerUrl,
    issuerUrl.replace(/\/application\/o\/[^/]+$/, ""),
    normalizedIssuerUrl.replace(/\/application\/o\/[^/]+$/, ""),
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

function applyProviderDefaults(
  config: OIDCConfig,
  providerType: string,
): OIDCConfig {
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

/**
 * Reads the provider secrets. System-key encrypted values are decrypted;
 * values still carrying a legacy base64 prefix are decoded so login keeps
 * working until the provider is next saved.
 */
async function decryptConfigSecret(
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return decryptSsoConfigSecrets(config);
}

export async function loadProviderConfig(
  providerId: number | null | undefined,
  adminUserId?: string,
): Promise<{
  config: OIDCConfig;
  providerType: SSOProviderType;
  providerDbId: number | null;
} | null> {
  if (providerId != null) {
    try {
      const row =
        await createCurrentSsoProviderRepository().findById(providerId);
      if (row) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(row.config);
        } catch {
          parsed = {};
        }
        if (adminUserId) {
          try {
            const adminDataKey = DataCrypto.getUserDataKey(adminUserId);
            if (adminDataKey) {
              parsed = DataCrypto.decryptRecord(
                "settings",
                parsed,
                adminUserId,
                adminDataKey,
              );
            }
          } catch {
            parsed = await decryptConfigSecret(parsed);
          }
        } else {
          parsed = await decryptConfigSecret(parsed);
        }
        const providerType = row.type as SSOProviderType;
        const config = applyProviderDefaults(
          parsed as unknown as OIDCConfig,
          providerType,
        );
        return {
          config,
          providerType,
          providerDbId: row.id,
        };
      }
    } catch (err) {
      authLogger.error("Failed to load SSO provider config by id", err, {
        providerId,
      });
    }
  }

  // Fallback: env vars
  const envConfig = getOIDCConfigFromEnv();
  if (envConfig) {
    return { config: envConfig, providerType: "oidc", providerDbId: null };
  }

  // Fallback: first enabled OIDC-type provider in ssoProviders table
  try {
    const oidcRow =
      await createCurrentSsoProviderRepository().findFirstEnabledOidcLike();
    if (oidcRow) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(oidcRow.config);
      } catch {
        parsed = {};
      }
      parsed = await decryptConfigSecret(parsed);
      const oidcProviderType = oidcRow.type as SSOProviderType;
      return {
        config: applyProviderDefaults(
          parsed as unknown as OIDCConfig,
          oidcProviderType,
        ),
        providerType: oidcProviderType,
        providerDbId: oidcRow.id,
      };
    }
  } catch {
    // fall through to legacy
  }

  // Fallback: legacy settings blob
  try {
    const legacyValue =
      await createCurrentSettingsRepository().get("oidc_config");
    if (legacyValue) {
      let config = JSON.parse(legacyValue) as Record<string, unknown>;
      config = await decryptConfigSecret(config);
      return {
        config: config as unknown as OIDCConfig,
        providerType: "oidc",
        providerDbId: null,
      };
    }
  } catch {
    // no legacy config
  }

  return null;
}

export async function resolveProviderByIssuer(issuer: string): Promise<{
  config: OIDCConfig;
  providerType: SSOProviderType;
  providerDbId: number | null;
} | null> {
  const target = normalizeIssuer(issuer);

  try {
    const rows = await createCurrentSsoProviderRepository().listEnabled();
    for (const row of rows) {
      if (!["oidc", "github", "google"].includes(row.type)) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.config);
      } catch {
        continue;
      }
      parsed = await decryptConfigSecret(parsed);
      const providerType = row.type as SSOProviderType;
      const config = applyProviderDefaults(
        parsed as unknown as OIDCConfig,
        providerType,
      );
      if (config.issuer_url && normalizeIssuer(config.issuer_url) === target) {
        return { config, providerType, providerDbId: row.id };
      }
    }
  } catch (err) {
    authLogger.error("Failed to resolve SSO provider by issuer", err, {
      issuer,
    });
  }

  const envConfig = getOIDCConfigFromEnv();
  if (
    envConfig?.issuer_url &&
    normalizeIssuer(envConfig.issuer_url) === target
  ) {
    return { config: envConfig, providerType: "oidc", providerDbId: null };
  }

  return null;
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
  config: OIDCConfig,
): Promise<LogoutTokenClaims> {
  const payload = await verifyOIDCToken(
    logoutToken,
    config.issuer_url,
    config.client_id,
    config.ca_cert,
  );

  return validateLogoutTokenClaims(payload);
}
