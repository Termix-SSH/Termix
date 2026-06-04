import { authLogger } from "../../utils/logger.js";

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
};

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
  };
}

export function isOIDCUserAllowed(
  allowedUsers: string,
  identifier: string,
  email?: string,
): boolean {
  if (!allowedUsers || !allowedUsers.trim()) return true;
  const patterns = allowedUsers
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (patterns.length === 0) return true;

  const values = [
    identifier,
    ...(email && email !== identifier ? [email] : []),
  ];
  for (const pattern of patterns) {
    if (pattern === "*") return true;
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
): Promise<Record<string, unknown>> {
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
    const discoveryResponse = await fetch(discoveryUrl);
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
      const response = await fetch(url);
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
