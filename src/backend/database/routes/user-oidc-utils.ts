import { authLogger } from "../../utils/logger.js";
import type { SSOProviderType } from "../../../types/index.js";
import { db } from "../db/index.js";
import { ssoProviders } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { DataCrypto } from "../../utils/data-crypto.js";
import { Agent } from "undici";

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

  try {
    const discoveryUrl = `${normalizedIssuerUrl}/.well-known/openid-configuration`;
    const discoveryResponse = await fetch(discoveryUrl, fetchOptions);
    if (discoveryResponse.ok) {
      const discovery = (await discoveryResponse.json()) as Record<
        string,
        unknown
      >;
      if (discovery.jwks_uri) {
        jwksUrls.unshift(discovery.jwks_uri as string);
      }
    }
  } catch (discoveryError) {
    authLogger.error(`OIDC discovery failed: ${discoveryError}`);
  }

  let jwks: Record<string, unknown> | null = null;

  for (const url of jwksUrls) {
    try {
      const response = await fetch(url, fetchOptions);
      if (response.ok) {
        const jwksData = (await response.json()) as Record<string, unknown>;
        if (jwksData && jwksData.keys && Array.isArray(jwksData.keys)) {
          jwks = jwksData;
          break;
        } else {
          authLogger.error(
            `Invalid JWKS structure from ${url}: ${JSON.stringify(jwksData)}`,
          );
        }
      } else {
        // expected - non-ok response, try next URL
      }
    } catch {
      continue;
    }
  }

  if (!jwks) {
    throw new Error("Failed to fetch JWKS from any URL");
  }

  if (!jwks.keys || !Array.isArray(jwks.keys)) {
    throw new Error(
      `Invalid JWKS response structure. Expected 'keys' array, got: ${JSON.stringify(jwks)}`,
    );
  }

  const header = JSON.parse(
    Buffer.from(idToken.split(".")[0], "base64").toString(),
  );
  const keyId = header.kid;

  const publicKey = jwks.keys.find(
    (key: Record<string, unknown>) => key.kid === keyId,
  );
  if (!publicKey) {
    throw new Error(
      `No matching public key found for key ID: ${keyId}. Available keys: ${jwks.keys.map((k: Record<string, unknown>) => k.kid).join(", ")}`,
    );
  }

  const { importJWK, jwtVerify } = await import("jose");
  const key = await importJWK(publicKey);

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

function decryptConfigSecret(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...config };
  for (const field of ["client_secret", "bindPassword"] as const) {
    const val = out[field] as string | undefined;
    if (val?.startsWith("encoded:")) {
      try {
        out[field] = Buffer.from(val.substring(8), "base64").toString("utf8");
      } catch {
        // leave as-is
      }
    } else if (val?.startsWith("encrypted:")) {
      // encrypted: prefix means it was encrypted with DataCrypto; without a
      // userId/dataKey here we cannot decrypt it. The caller should use the
      // full admin decrypt path when possible. Fall back to stripping prefix.
      try {
        out[field] = Buffer.from(val.substring(10), "base64").toString("utf8");
      } catch {
        // leave as-is
      }
    }
  }
  return out;
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
      const rows = await db
        .select()
        .from(ssoProviders)
        .where(eq(ssoProviders.id, providerId))
        .limit(1);
      if (rows.length > 0) {
        const row = rows[0];
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
            parsed = decryptConfigSecret(parsed);
          }
        } else {
          parsed = decryptConfigSecret(parsed);
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
    const rows = await db
      .select()
      .from(ssoProviders)
      .where(eq(ssoProviders.enabled, true))
      .orderBy();
    const oidcRow = rows.find(
      (r) => r.type === "oidc" || r.type === "github" || r.type === "google",
    );
    if (oidcRow) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(oidcRow.config);
      } catch {
        parsed = {};
      }
      parsed = decryptConfigSecret(parsed);
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
    const legacyRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'oidc_config'")
      .get() as { value: string } | undefined;
    if (legacyRow) {
      let config = JSON.parse(legacyRow.value) as Record<string, unknown>;
      config = decryptConfigSecret(config);
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
