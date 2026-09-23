/**
 * OIDC, GitHub and Google sign-in, moved out of the users routes so they can
 * register as a login method. Phase C moves this into the OIDC plugin.
 *
 * start builds the provider's authorize URL; callback turns the provider's
 * answer into a verified identity. Neither touches sessions.
 */

import crypto from "crypto";
import type { Request } from "express";
import { nanoid } from "nanoid";
import { authLogger } from "../../utils/logger.js";
import { getRequestOriginWithForceHTTPS } from "../../utils/request-origin.js";
import { getDesktopOidcCallbackUrl } from "../../utils/oidc-desktop-callback.js";
import { createCurrentSettingsRepository } from "../../database/repositories/factory.js";
import {
  OIDCTokenFormatError,
  buildFetchOptions,
  extractOidcGroupsFromSources,
  loadProviderConfig,
  parseOidcRoleMap,
  resolveOidcMappedRoles,
  verifyOIDCToken,
} from "../../database/routes/user-oidc-utils.js";
import { LoginMethodError, type VerifiedIdentity } from "../types.js";

/** An error raised after the return address is known redirects there. */
export class RedirectLoginError extends LoginMethodError {
  constructor(
    message: string,
    readonly returnTo: string,
    status = 400,
    code?: string,
  ) {
    super(message, status, code);
    this.name = "RedirectLoginError";
  }
}

/** Provider id used for OIDC identities that came from env configuration. */
export const LEGACY_OIDC_PROVIDER_ID = "legacy-oidc";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// RFC 7636 PKCE: 43-128 char unreserved-character string.
function generatePkceCodeVerifier(): string {
  return crypto.randomBytes(64).toString("base64url");
}

function generatePkceCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function deleteOIDCStateSettings(state: string): Promise<void> {
  const settingsRepository = createCurrentSettingsRepository();
  await settingsRepository.delete(`oidc_state_${state}`);
  await settingsRepository.delete(`oidc_backend_callback_${state}`);
  await settingsRepository.delete(`oidc_frontend_origin_${state}`);
  await settingsRepository.delete(`oidc_remember_me_${state}`);
  await settingsRepository.delete(`oidc_provider_${state}`);
  await settingsRepository.delete(`oidc_pkce_verifier_${state}`);
}

export async function startOidcLogin(
  req: Request,
  overrides: { providerId?: string | null } = {},
): Promise<{ auth_url: string; state: string; nonce: string }> {
  const { rememberMe, desktopCallbackPort, appCallbackUrl } = req.query;
  const providerIdStr = overrides.providerId ?? req.query.providerId;
  const origin = getRequestOriginWithForceHTTPS(req);
  const basePath = (process.env.BASE_PATH || "").replace(/\/+$/, "");
  const backendCallbackUri = `${origin}${basePath}/users/oidc/callback`;

  const resolvedProviderId = providerIdStr
    ? parseInt(providerIdStr as string, 10)
    : null;
  const providerResult = await loadProviderConfig(
    resolvedProviderId || undefined,
  );
  if (!providerResult) {
    throw new LoginMethodError("OIDC not configured", 404);
  }
  const { config, providerDbId } = providerResult;
  const state = nanoid();
  const nonce = nanoid();

  const referer = req.get("Referer");
  let frontendOrigin: string;
  if (desktopCallbackPort) {
    frontendOrigin = getDesktopOidcCallbackUrl(desktopCallbackPort);
    if (!frontendOrigin) {
      throw new LoginMethodError("Invalid desktop callback port", 400);
    }
  } else if (typeof appCallbackUrl === "string" && appCallbackUrl) {
    let callbackUrl: URL;
    try {
      callbackUrl = new URL(appCallbackUrl);
    } catch {
      throw new LoginMethodError("Invalid app callback URL", 400);
    }
    if (callbackUrl.protocol !== "termix-mobile:") {
      throw new LoginMethodError("Unsupported app callback URL", 400);
    }
    frontendOrigin = callbackUrl.toString();
  } else if (referer) {
    const refererUrl = new URL(referer);
    frontendOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
  } else {
    frontendOrigin = origin;
  }

  const codeVerifier = generatePkceCodeVerifier();
  const codeChallenge = generatePkceCodeChallenge(codeVerifier);

  const settingsRepository = createCurrentSettingsRepository();
  await settingsRepository.set(`oidc_state_${state}`, nonce);
  await settingsRepository.set(
    `oidc_backend_callback_${state}`,
    backendCallbackUri,
  );
  await settingsRepository.set(`oidc_frontend_origin_${state}`, frontendOrigin);
  await settingsRepository.set(
    `oidc_remember_me_${state}`,
    rememberMe === "true" ? "true" : "false",
  );
  await settingsRepository.set(`oidc_pkce_verifier_${state}`, codeVerifier);
  if (providerDbId != null) {
    await settingsRepository.set(
      `oidc_provider_${state}`,
      String(providerDbId),
    );
  }

  const authUrl = new URL(config.authorization_url);
  authUrl.searchParams.set("client_id", config.client_id);
  authUrl.searchParams.set("redirect_uri", backendCallbackUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", config.scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return { auth_url: authUrl.toString(), state, nonce };
}

type ProviderConfig = NonNullable<
  Awaited<ReturnType<typeof loadProviderConfig>>
>["config"];

async function githubIdentity(
  code: string,
  state: string,
  config: ProviderConfig,
  providerDbId: number | null,
  backendCallbackUri: string,
  frontendOrigin: string,
  rememberMe: boolean,
): Promise<VerifiedIdentity> {
  const fetchOptions = buildFetchOptions(config.ca_cert);
  const tokenResponse = await fetch(config.token_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.client_id,
      client_secret: config.client_secret,
      code,
      redirect_uri: backendCallbackUri,
    }),
    ...fetchOptions,
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    authLogger.error("GitHub token exchange failed", {
      operation: "github_token_exchange_failed",
      status: tokenResponse.status,
      errorResponse: errorText,
    });
    throw new LoginMethodError("Failed to exchange authorization code", 400);
  }

  const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
  await deleteOIDCStateSettings(state);

  const userInfoResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/json",
      "User-Agent": "Termix",
    },
    ...fetchOptions,
  });
  if (!userInfoResponse.ok) {
    throw new LoginMethodError("Failed to get GitHub user information", 400);
  }
  const userInfo = (await userInfoResponse.json()) as Record<string, unknown>;

  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/json",
      "User-Agent": "Termix",
    },
  });
  if (emailResponse.ok) {
    const emails = (await emailResponse.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    const primary = emails.find((e) => e.primary && e.verified);
    if (primary) userInfo.email = primary.email;
  }

  const subject = String(userInfo.id ?? userInfo.login);
  const legacyIdentifier = `github:${providerDbId}:${subject}`;
  return {
    kind: "external",
    provider: String(providerDbId ?? LEGACY_OIDC_PROVIDER_ID),
    subject,
    email: (userInfo.email as string | undefined) ?? null,
    name: ((userInfo.name || userInfo.login) as string) || legacyIdentifier,
    allowedUsers: config.allowed_users ?? null,
    legacyIdentifier,
    ssoProviderId: providerDbId,
    returnTo: frontendOrigin,
    rememberMe,
  };
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path || !obj) return null;
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) => (current as Record<string, unknown>)?.[key],
      obj,
    );
}

/**
 * The provider's callback. Throws RedirectLoginError once the return address
 * is known, and a plain LoginMethodError (answered as JSON) before that.
 */
export async function handleOidcCallback(
  req: Request,
): Promise<VerifiedIdentity> {
  const { code, state } = req.query;
  if (!nonEmpty(code) || !nonEmpty(state)) {
    throw new LoginMethodError("Code and state are required", 400);
  }

  const settingsRepository = createCurrentSettingsRepository();
  const backendCallbackUri = await settingsRepository.get(
    `oidc_backend_callback_${state}`,
  );
  const frontendOrigin = await settingsRepository.get(
    `oidc_frontend_origin_${state}`,
  );
  const rememberMe =
    (await settingsRepository.get(`oidc_remember_me_${state}`)) === "true";
  const codeVerifier = await settingsRepository.get(
    `oidc_pkce_verifier_${state}`,
  );

  if (!backendCallbackUri || !frontendOrigin) {
    throw new LoginMethodError(
      "Invalid state parameter - redirect URIs not found",
      400,
    );
  }

  try {
    const storedNonce = await settingsRepository.get(`oidc_state_${state}`);
    if (!storedNonce) {
      throw new LoginMethodError("Invalid state parameter", 400);
    }

    const storedProviderId = await settingsRepository.get(
      `oidc_provider_${state}`,
    );
    const callbackProviderId = storedProviderId
      ? parseInt(storedProviderId, 10)
      : null;
    const providerResult = await loadProviderConfig(
      callbackProviderId || undefined,
    );
    if (!providerResult) {
      throw new LoginMethodError("OIDC not configured", 500);
    }
    const { config, providerType, providerDbId } = providerResult;
    await settingsRepository.delete(`oidc_provider_${state}`);

    // GitHub does not issue OIDC id_tokens; it has its own token exchange.
    if (providerType === "github") {
      return await githubIdentity(
        code,
        state,
        config,
        providerDbId ?? null,
        backendCallbackUri,
        frontendOrigin,
        rememberMe,
      );
    }

    const caCert = config.ca_cert;
    const fetchOptions = buildFetchOptions(caCert);
    const tokenResponse = await fetch(config.token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.client_id,
        client_secret: config.client_secret,
        code,
        redirect_uri: backendCallbackUri,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }),
      ...fetchOptions,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      authLogger.error("OIDC token exchange failed", {
        operation: "oidc_token_exchange_failed",
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        backendCallbackUri,
        frontendOrigin,
        errorResponse: errorText,
      });
      throw new LoginMethodError("Failed to exchange authorization code", 400);
    }

    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
    await deleteOIDCStateSettings(state);

    let userInfo: Record<string, unknown> | null = null;
    const claimSources: Record<string, unknown>[] = [];
    const userInfoUrls: string[] = [];

    const normalizedIssuerUrl = config.issuer_url.endsWith("/")
      ? config.issuer_url.slice(0, -1)
      : config.issuer_url;
    const baseUrl = normalizedIssuerUrl.replace(/\/application\/o\/[^/]+$/, "");

    try {
      const discoveryResponse = await fetch(
        `${normalizedIssuerUrl}/.well-known/openid-configuration`,
        fetchOptions,
      );
      if (discoveryResponse.ok) {
        const discovery = (await discoveryResponse.json()) as Record<
          string,
          unknown
        >;
        if (discovery.userinfo_endpoint) {
          userInfoUrls.push(discovery.userinfo_endpoint as string);
        }
      }
    } catch (discoveryError) {
      authLogger.error(`OIDC discovery failed: ${discoveryError}`);
    }

    if (config.userinfo_url) userInfoUrls.unshift(config.userinfo_url);
    userInfoUrls.push(
      `${baseUrl}/userinfo/`,
      `${baseUrl}/userinfo`,
      `${normalizedIssuerUrl}/userinfo/`,
      `${normalizedIssuerUrl}/userinfo`,
      `${baseUrl}/oauth2/userinfo/`,
      `${baseUrl}/oauth2/userinfo`,
      `${normalizedIssuerUrl}/oauth2/userinfo/`,
      `${normalizedIssuerUrl}/oauth2/userinfo`,
    );

    if (tokenData.id_token) {
      try {
        userInfo = await verifyOIDCToken(
          tokenData.id_token as string,
          config.issuer_url,
          config.client_id,
          caCert,
        );
        if (userInfo.nonce !== storedNonce) {
          authLogger.warn("OIDC ID token nonce mismatch", {
            operation: "oidc_nonce_mismatch",
            providerId: callbackProviderId,
          });
          throw new LoginMethodError("Invalid OIDC token nonce", 401);
        }
        claimSources.push(userInfo);
      } catch (error) {
        // A token that is not a JWS carries no claims we could trust; fall
        // through to userinfo. Signature and claim failures still reject.
        if (!(error instanceof OIDCTokenFormatError)) throw error;
        userInfo = null;
        authLogger.warn(
          "OIDC ID token cannot be verified, falling back to userinfo endpoint",
          {
            operation: "oidc_id_token_unverifiable",
            providerId: callbackProviderId,
            reason: error.message,
          },
        );
      }
    }

    if (tokenData.access_token) {
      for (const userInfoUrl of userInfoUrls) {
        try {
          const response = await fetch(userInfoUrl, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
            ...fetchOptions,
          });
          if (response.ok) {
            const fetched = (await response.json()) as Record<string, unknown>;
            claimSources.push(fetched);
            userInfo = { ...userInfo, ...fetched };
            break;
          }
          authLogger.error(
            `Userinfo endpoint ${userInfoUrl} failed with status: ${response.status}`,
          );
        } catch (error) {
          authLogger.error(`Userinfo endpoint ${userInfoUrl} failed:`, error);
        }
      }
    }

    if (!userInfo) {
      authLogger.error("Failed to get user information from all sources");
      throw new LoginMethodError("Failed to get user information", 400);
    }

    const identifier = (getNestedValue(userInfo, config.identifier_path) ||
      userInfo[config.identifier_path] ||
      userInfo.sub ||
      userInfo.email ||
      userInfo.preferred_username) as string;
    const name = (getNestedValue(userInfo, config.name_path) ||
      userInfo[config.name_path] ||
      userInfo.name ||
      userInfo.given_name ||
      identifier) as string;

    if (!identifier) {
      throw new LoginMethodError(
        `User identifier not found at path: ${config.identifier_path}. Available fields: ${Object.keys(userInfo).join(", ")}`,
        400,
      );
    }

    let isAdmin: boolean | undefined;
    if (config.admin_group) {
      const groups = extractOidcGroupsFromSources(
        claimSources,
        config.group_claim,
      );
      isAdmin = groups.includes(config.admin_group);
    }

    let roleSync: { desired: string[]; managed: string[] } | undefined;
    try {
      const roleMap = parseOidcRoleMap(
        config.role_map ?? process.env.OIDC_ROLE_MAP,
      );
      if (roleMap.size > 0) {
        const groups = extractOidcGroupsFromSources(
          claimSources,
          config.group_claim,
        );
        const { desired, managed } = resolveOidcMappedRoles(groups, roleMap);
        roleSync = { desired: [...desired], managed: [...managed] };
      }
    } catch (roleMapError) {
      authLogger.error("Failed to read the OIDC role map", roleMapError, {
        operation: "oidc_role_map_sync_failed",
      });
    }

    return {
      kind: "external",
      provider: String(providerDbId ?? LEGACY_OIDC_PROVIDER_ID),
      subject: identifier,
      email: (userInfo.email as string | undefined) ?? null,
      name,
      isAdmin,
      allowedUsers: config.allowed_users ?? null,
      legacyIdentifier: identifier,
      ssoProviderId: providerDbId ?? null,
      oidcSub: typeof userInfo.sub === "string" ? userInfo.sub : null,
      oidcSid: typeof userInfo.sid === "string" ? userInfo.sid : null,
      roleSync,
      returnTo: frontendOrigin,
      rememberMe,
    };
  } catch (error) {
    if (error instanceof LoginMethodError) throw error;
    authLogger.error("OIDC callback failed", error);
    throw new RedirectLoginError(
      "OIDC authentication failed",
      frontendOrigin,
      500,
    );
  }
}
