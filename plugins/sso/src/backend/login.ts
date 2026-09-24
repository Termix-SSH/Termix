/**
 * The OIDC, GitHub and Google sign-in. start builds the provider's authorize
 * URL; callback turns the provider's answer into a verified identity. Core
 * finds or provisions the user and issues the session.
 */

import crypto from "node:crypto";
import {
  LoginMethodError,
  type PluginContext,
  type PluginLoginRequest,
  type PluginVerifiedIdentity,
} from "@termix/plugin-sdk/backend";
import {
  OIDCTokenFormatError,
  buildFetchOptions,
  extractOidcGroupsFromSources,
  generatePkceCodeChallenge,
  generatePkceCodeVerifier,
  getDesktopCallbackUrl,
  getNestedValue,
  parseOidcRoleMap,
  resolveOidcMappedRoles,
  verifyOIDCToken,
} from "./oidc-protocol.js";
import {
  ENV_INSTANCE_ID,
  ENV_PROVIDER_ID,
  type ProviderStore,
} from "./providers.js";
import type { OidcConfig, ResolvedProvider } from "./types.js";

export const METHOD_ID = "oidc";
export const CALLBACK_PATH = "/plugin-api/sso/callback";
/** The redirect URI identity providers were set up with before 2.9. */
export const LEGACY_CALLBACK_PATH = "/users/oidc/callback";

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_PREFIX = "state:";

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

interface PendingState {
  nonce: string;
  backendCallback: string;
  frontendOrigin: string;
  rememberMe: boolean;
  providerId: number | null;
  codeVerifier: string;
  createdAt: number;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function header(request: PluginLoginRequest, name: string): string {
  const value = request.headers[name];
  return typeof (Array.isArray(value) ? value[0] : value) === "string"
    ? String(Array.isArray(value) ? value[0] : value)
    : "";
}

export function redirectUriFor(
  baseUrl: string,
  provider: Pick<ResolvedProvider, "legacyCallback">,
): string {
  return `${baseUrl}${provider.legacyCallback ? LEGACY_CALLBACK_PATH : CALLBACK_PATH}`;
}

export type SsoLogin = ReturnType<typeof createSsoLogin>;

export function createSsoLogin(ctx: PluginContext, store: ProviderStore) {
  async function saveState(state: string, pending: PendingState) {
    // Drop anything abandoned so the store does not grow.
    const now = Date.now();
    for (const key of await ctx.kv.list()) {
      if (!key.startsWith(STATE_PREFIX)) continue;
      const entry = (await ctx.kv.get(key)) as PendingState | undefined;
      if (!entry || now - entry.createdAt > STATE_TTL_MS) {
        await ctx.kv.delete(key);
      }
    }
    await ctx.kv.set(`${STATE_PREFIX}${state}`, pending);
  }

  async function takeState(state: string): Promise<PendingState | null> {
    const key = `${STATE_PREFIX}${state}`;
    const entry = (await ctx.kv.get(key)) as PendingState | undefined;
    if (!entry) return null;
    await ctx.kv.delete(key);
    return Date.now() - entry.createdAt > STATE_TTL_MS ? null : entry;
  }

  function frontendOriginFor(
    request: PluginLoginRequest,
    baseUrl: string,
  ): string {
    const { desktopCallbackPort, appCallbackUrl } = request.query;
    if (desktopCallbackPort !== undefined && desktopCallbackPort !== "") {
      const url = getDesktopCallbackUrl(desktopCallbackPort);
      if (!url) {
        throw new LoginMethodError("Invalid desktop callback port", 400);
      }
      return url;
    }
    if (typeof appCallbackUrl === "string" && appCallbackUrl) {
      let callbackUrl: URL;
      try {
        callbackUrl = new URL(appCallbackUrl);
      } catch {
        throw new LoginMethodError("Invalid app callback URL", 400);
      }
      if (callbackUrl.protocol !== "termix-mobile:") {
        throw new LoginMethodError("Unsupported app callback URL", 400);
      }
      return callbackUrl.toString();
    }
    const referer = header(request, "referer");
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        return `${refererUrl.protocol}//${refererUrl.host}`;
      } catch {
        // fall through to the request's own origin
      }
    }
    return new URL(baseUrl).origin;
  }

  async function start(
    request: PluginLoginRequest,
    instanceId: string | null,
  ): Promise<{ redirectUrl: string }> {
    const requested =
      instanceId ??
      (typeof request.query.providerId === "string"
        ? request.query.providerId
        : null);
    const rowId =
      requested && requested !== ENV_INSTANCE_ID
        ? Number.parseInt(requested, 10)
        : null;
    if (rowId !== null && !Number.isInteger(rowId)) {
      throw new LoginMethodError("OIDC not configured", 404);
    }
    const provider = await store.resolve(rowId);
    if (!provider) throw new LoginMethodError("OIDC not configured", 404);

    const baseUrl = ctx.http.baseUrl(request);
    const backendCallback = redirectUriFor(baseUrl, provider);
    const frontendOrigin = frontendOriginFor(request, baseUrl);
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const codeVerifier = generatePkceCodeVerifier();

    await saveState(state, {
      nonce,
      backendCallback,
      frontendOrigin,
      rememberMe: String(request.query.rememberMe) === "true",
      providerId: provider.rowId,
      codeVerifier,
      createdAt: Date.now(),
    });

    const authUrl = new URL(provider.config.authorization_url);
    authUrl.searchParams.set("client_id", provider.config.client_id);
    authUrl.searchParams.set("redirect_uri", backendCallback);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", provider.config.scopes);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("nonce", nonce);
    authUrl.searchParams.set(
      "code_challenge",
      generatePkceCodeChallenge(codeVerifier),
    );
    authUrl.searchParams.set("code_challenge_method", "S256");
    return { redirectUrl: authUrl.toString() };
  }

  async function exchangeCode(
    config: OidcConfig,
    code: string,
    pending: PendingState,
    withVerifier: boolean,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(config.token_url, {
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
        redirect_uri: pending.backendCallback,
        ...(withVerifier ? { code_verifier: pending.codeVerifier } : {}),
      }),
      ...buildFetchOptions(config.ca_cert),
    } as RequestInit);
    if (!response.ok) {
      ctx.log.error(
        "Token exchange failed",
        new Error(`HTTP ${response.status}: ${await response.text()}`),
      );
      throw new LoginMethodError("Failed to exchange authorization code", 400);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  function providerKey(provider: ResolvedProvider): string {
    return provider.rowId === null ? ENV_PROVIDER_ID : String(provider.rowId);
  }

  async function githubIdentity(
    provider: ResolvedProvider,
    code: string,
    pending: PendingState,
  ): Promise<PluginVerifiedIdentity> {
    const tokenData = await exchangeCode(provider.config, code, pending, false);
    const fetchOptions = buildFetchOptions(provider.config.ca_cert);
    const headers = {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/json",
      "User-Agent": "Termix",
    };
    const userInfoResponse = await fetch("https://api.github.com/user", {
      headers,
      ...fetchOptions,
    } as RequestInit);
    if (!userInfoResponse.ok) {
      throw new LoginMethodError("Failed to get GitHub user information", 400);
    }
    const userInfo = (await userInfoResponse.json()) as Record<string, unknown>;

    const emailResponse = await fetch("https://api.github.com/user/emails", {
      headers,
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
    const legacyIdentifier = `github:${provider.rowId}:${subject}`;
    return {
      kind: "external",
      provider: providerKey(provider),
      subject,
      email: (userInfo.email as string | undefined) ?? null,
      name: ((userInfo.name || userInfo.login) as string) || legacyIdentifier,
      allowedUsers: provider.config.allowed_users ?? null,
      legacy: { identifier: legacyIdentifier, providerRowId: provider.rowId },
      returnTo: pending.frontendOrigin,
      rememberMe: pending.rememberMe,
    };
  }

  async function fetchUserInfo(
    config: OidcConfig,
    accessToken: unknown,
    userInfo: Record<string, unknown> | null,
    claimSources: Record<string, unknown>[],
  ): Promise<Record<string, unknown> | null> {
    const fetchOptions = buildFetchOptions(config.ca_cert);
    const issuer = config.issuer_url.endsWith("/")
      ? config.issuer_url.slice(0, -1)
      : config.issuer_url;
    const base = issuer.replace(/\/application\/o\/[^/]+$/, "");
    const urls: string[] = [];

    try {
      const discovery = await fetch(
        `${issuer}/.well-known/openid-configuration`,
        fetchOptions as RequestInit,
      );
      if (discovery.ok) {
        const document = (await discovery.json()) as Record<string, unknown>;
        if (typeof document.userinfo_endpoint === "string") {
          urls.push(document.userinfo_endpoint);
        }
      }
    } catch (error) {
      ctx.log.warn(`OIDC discovery failed: ${String(error)}`);
    }

    if (config.userinfo_url) urls.unshift(config.userinfo_url);
    urls.push(
      `${base}/userinfo/`,
      `${base}/userinfo`,
      `${issuer}/userinfo/`,
      `${issuer}/userinfo`,
      `${base}/oauth2/userinfo/`,
      `${base}/oauth2/userinfo`,
      `${issuer}/oauth2/userinfo/`,
      `${issuer}/oauth2/userinfo`,
    );

    if (!accessToken) return userInfo;
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          ...fetchOptions,
        } as RequestInit);
        if (response.ok) {
          const fetched = (await response.json()) as Record<string, unknown>;
          claimSources.push(fetched);
          return { ...userInfo, ...fetched };
        }
        ctx.log.warn(`Userinfo endpoint ${url} answered ${response.status}`);
      } catch (error) {
        ctx.log.warn(`Userinfo endpoint ${url} failed: ${String(error)}`);
      }
    }
    return userInfo;
  }

  async function oidcIdentity(
    provider: ResolvedProvider,
    code: string,
    pending: PendingState,
  ): Promise<PluginVerifiedIdentity> {
    const { config } = provider;
    const tokenData = await exchangeCode(config, code, pending, true);

    let userInfo: Record<string, unknown> | null = null;
    const claimSources: Record<string, unknown>[] = [];

    if (typeof tokenData.id_token === "string") {
      try {
        userInfo = await verifyOIDCToken(
          tokenData.id_token,
          config.issuer_url,
          config.client_id,
          config.ca_cert,
        );
        if (userInfo.nonce !== pending.nonce) {
          ctx.log.warn("OIDC ID token nonce mismatch");
          throw new LoginMethodError("Invalid OIDC token nonce", 401);
        }
        claimSources.push(userInfo);
      } catch (error) {
        // A token that is not a JWS carries no claims we could trust; fall
        // through to userinfo. Signature and claim failures still reject.
        if (!(error instanceof OIDCTokenFormatError)) throw error;
        userInfo = null;
        ctx.log.warn(
          `OIDC ID token cannot be verified, using userinfo: ${error.message}`,
        );
      }
    }

    userInfo = await fetchUserInfo(
      config,
      tokenData.access_token,
      userInfo,
      claimSources,
    );
    if (!userInfo) {
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

    const groups = extractOidcGroupsFromSources(
      claimSources,
      config.group_claim,
    );
    const isAdmin = config.admin_group
      ? groups.includes(config.admin_group)
      : undefined;

    let roles: { desired: string[]; managed: string[] } | undefined;
    const roleMap = parseOidcRoleMap(
      config.role_map ?? process.env.OIDC_ROLE_MAP,
    );
    if (roleMap.size > 0) {
      const { desired, managed } = resolveOidcMappedRoles(groups, roleMap);
      roles = { desired: [...desired], managed: [...managed] };
    }

    return {
      kind: "external",
      provider: providerKey(provider),
      subject: String(identifier),
      email: (userInfo.email as string | undefined) ?? null,
      name,
      groups,
      isAdmin,
      allowedUsers: config.allowed_users ?? null,
      roles,
      logoutClaims: {
        providerId: provider.rowId,
        sub: typeof userInfo.sub === "string" ? userInfo.sub : null,
        sid: typeof userInfo.sid === "string" ? userInfo.sid : null,
      },
      legacy: { identifier: String(identifier), providerRowId: provider.rowId },
      returnTo: pending.frontendOrigin,
      rememberMe: pending.rememberMe,
    };
  }

  /**
   * The provider's callback. Throws RedirectLoginError once the return
   * address is known, and a plain LoginMethodError (answered as JSON) before.
   */
  async function callback(
    request: PluginLoginRequest,
  ): Promise<PluginVerifiedIdentity> {
    const source = { ...request.query, ...(request.body ?? {}) };
    const { code, state } = source as Record<string, unknown>;
    if (!nonEmpty(code) || !nonEmpty(state)) {
      throw new LoginMethodError("Code and state are required", 400);
    }
    const pending = await takeState(state);
    if (!pending) throw new LoginMethodError("Invalid state parameter", 400);

    try {
      const provider = await store.resolve(pending.providerId);
      if (!provider) throw new LoginMethodError("OIDC not configured", 500);
      // GitHub does not issue OIDC id_tokens; it has its own token exchange.
      return provider.type === "github"
        ? await githubIdentity(provider, code, pending)
        : await oidcIdentity(provider, code, pending);
    } catch (error) {
      if (error instanceof LoginMethodError) {
        throw new RedirectLoginError(
          error.message,
          pending.frontendOrigin,
          error.status,
          error.code,
        );
      }
      ctx.log.error(
        "OIDC callback failed",
        error instanceof Error ? error : new Error(String(error)),
      );
      throw new RedirectLoginError(
        "OIDC authentication failed",
        pending.frontendOrigin,
        500,
      );
    }
  }

  return { start, callback };
}
