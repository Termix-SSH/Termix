/**
 * ctx.ssh and ctx.auth.
 *
 * ctx.ssh is a thin, capability-checked door onto core's connect pipeline.
 * ctx.auth registers login methods, second factors and SSH auth types into
 * core's registries, scoped to the plugin's manifest and its disposable bag.
 */

import type {
  PluginAuth,
  PluginVerifiedIdentity,
  PluginSsh,
  PluginSshConnectOptions,
  PluginSshHost,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { PluginSshInteractionError } from "@termix/plugin-sdk/backend";
import {
  assertCapability,
  capabilityRefused,
  hasCachedCapability,
  hasCapability,
  warmPluginGrants,
} from "./permissions.js";
import { getActor, getActorSessionId } from "./actor.js";
import type { DisposableBag } from "./disposables.js";
import { redactHostSecrets } from "./ctx-hosts.js";
import {
  getSshAuthProvider,
  listSshAuthProviders,
  registerKeyboardInteractiveInterceptor,
  registerSshAuthProvider,
} from "../hosts/connect/auth-provider-registry.js";
import { classifyKeyboardInteractive } from "../hosts/connect/keyboard-interactive.js";
import { ensureCoreSshAuthProviders } from "../hosts/connect/core-providers.js";
import {
  getLoginMethod,
  registerLoginMethod,
  registerSecondFactor,
} from "../auth/registry.js";
import type { VerifiedIdentity } from "../auth/types.js";
import type {
  MutableConnectConfig,
  SshAuthProvider,
  SshConnectHost,
  SshConnectProfile,
  SshConnectPurpose,
} from "../hosts/connect/types.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  bag: DisposableBag;
  audit: AuditFn;
}

const PLUGIN_PROFILES = new Set<SshConnectProfile>([
  "terminal",
  "session",
  "stream",
  "forward",
  "background",
]);

function purposeOf(options?: { purpose?: string }): SshConnectPurpose {
  return options?.purpose || "plugin";
}

// "jump" belongs to core's own jump chain; a plugin gets background.
function profileOf(options?: { profile?: string }): SshConnectProfile {
  const profile = options?.profile as SshConnectProfile | undefined;
  return profile && PLUGIN_PROFILES.has(profile) ? profile : "background";
}

/**
 * The user a connection runs as: the actor, or for a host core resolved
 * earlier, the user it was resolved for. A host object's own userId is plugin
 * data and is never believed, or a plugin could borrow another user's jump
 * hosts and stored credentials by naming them.
 */
function actingUser(resolvedFor?: string): string {
  const actor = getActor() ?? resolvedFor;
  if (actor) return actor;
  throw new Error(
    "ctx.ssh needs an acting user: call it inside a request or ctx.asUser",
  );
}

function describeHost(host: number | PluginSshHost): string {
  return typeof host === "number" ? `host ${host}` : `host ${host.id}`;
}

export function createPluginSsh({ manifest, bag, audit }: Deps): PluginSsh {
  const pluginId = manifest.id;
  const declared = manifest.capabilities;
  const open = new Set<() => void>();
  // Pool key -> host id, so dropPooled can find a host's keys after its
  // address changed.
  const poolKeys = new Map<string, number>();

  bag.add(async () => {
    for (const dispose of [...open]) dispose();
    open.clear();
    if (poolKeys.size > 0) {
      const { connectionPool } =
        await import("../hosts/ssh-connection-pool.js");
      for (const key of poolKeys.keys()) {
        connectionPool.clearKeyConnections(key);
      }
      poolKeys.clear();
    }
  }, "SSH connections");

  const checkSsh = async (withCredentials: boolean) => {
    await assertCapability(pluginId, "ssh:connect", declared);
    if (withCredentials) {
      await assertCapability(pluginId, "credentials:use", declared);
    }
  };

  // Hosts core resolved, keyed by the redacted copy the plugin was given, so
  // handing that copy back to connect still connects with the real secrets.
  const resolvedHosts = new WeakMap<
    object,
    { host: SshConnectHost; userId: string }
  >();

  const remember = (key: object, host: SshConnectHost, userId: string) =>
    resolvedHosts.set(key, { host, userId });

  const handOut = (host: SshConnectHost, userId: string): PluginSshHost => {
    const redacted = redactHostSecrets(
      host as unknown as Record<string, unknown>,
    ) as unknown as PluginSshHost;
    remember(redacted, host, userId);
    return redacted;
  };

  /** The acting user for a call about this host. */
  const userFor = (host: number | PluginSshHost | undefined): string =>
    actingUser(
      host && typeof host === "object"
        ? resolvedHosts.get(host)?.userId
        : undefined,
    );

  /**
   * A host for core's pipeline. An id stays an id (core resolves it with an
   * access check). An object core handed out maps back to what core resolved;
   * any other object is the plugin's own, so it runs as the actor.
   */
  const toConnectHost = (
    host: number | PluginSshHost,
    userId: string,
  ): number | SshConnectHost => {
    if (typeof host === "number") return host;
    const known = resolvedHosts.get(host);
    if (known) return known.host;
    return { ...(host as unknown as SshConnectHost), userId };
  };

  /** Checks, connects and audits one new connection. */
  const connectOnce = async (
    host: number | PluginSshHost,
    options?: PluginSshConnectOptions,
  ) => {
    try {
      await checkSsh(true);
    } catch (error) {
      await audit("ssh_connect", describeHost(host), {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    let userId: string;
    try {
      userId = userFor(host);
    } catch (error) {
      await audit("ssh_connect", describeHost(host), {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const { connectHost } = await import("../hosts/connect/connect-host.js");
    try {
      const connection = await connectHost(toConnectHost(host, userId), {
        userId,
        purpose: purposeOf(options),
        profile: profileOf(options),
        timeoutMs: options?.timeoutMs,
        prompt: options?.prompt,
        overrides: options?.overrides as Partial<MutableConnectConfig>,
        sock: options?.sock as MutableConnectConfig["sock"],
      });
      await audit("ssh_connect", describeHost(host), { success: true });

      const dispose = () => {
        open.delete(dispose);
        connection.dispose();
      };
      open.add(dispose);
      connection.client.once("close", () => open.delete(dispose));
      return {
        ...connection,
        host: handOut(connection.host as SshConnectHost, userId),
        dispose,
      };
    } catch (error) {
      await audit("ssh_connect", describeHost(host), {
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const poolKey = (pool: string, host: PluginSshHost) =>
    `${pool}:${host.userId}:${host.ip}:${host.port}:${host.username}${
      host.useSocks5 ? `:socks5:${host.socks5Host}:${host.socks5Port}` : ""
    }`;

  return {
    connect: async (host, options) => {
      const connection = await connectOnce(host, options);
      return {
        client: connection.client as never,
        jumpClient: connection.jumpClient as never,
        host: connection.host,
        dispose: connection.dispose,
      };
    },

    withConnection: async (host, options, fn) => {
      await checkSsh(true);
      const { resolveConnectHost } =
        await import("../hosts/connect/connect-host.js");
      const userId = userFor(host);
      const resolved = await resolveConnectHost(
        toConnectHost(host, userId),
        userId,
      );
      remember(resolved, resolved, userId);
      const key = poolKey(options.pool, resolved as PluginSshHost);
      poolKeys.set(key, resolved.id);
      const { withConnection } =
        await import("../hosts/ssh-connection-pool.js");
      return withConnection(
        key,
        async () =>
          (await connectOnce(resolved as PluginSshHost, options)).client,
        (client) => fn(client as never),
      );
    },

    jumpChain: async (jumpHosts, chainOptions) => {
      await checkSsh(true);
      const userId = userFor(chainOptions?.forHost);
      const { createJumpHostChain } =
        await import("../hosts/jump-host-chain.js");
      const client = await createJumpHostChain(jumpHosts, userId);
      const details = `jump chain of ${jumpHosts.length} hop(s)`;
      if (!client) {
        await audit("ssh_jump_chain", details, {
          success: false,
          errorMessage: "Jump host chain could not be established",
        });
        throw new Error("Jump host chain could not be established");
      }
      await audit("ssh_jump_chain", details, { success: true });
      const dispose = () => {
        open.delete(dispose);
        client.end();
      };
      open.add(dispose);
      client.once("close", () => open.delete(dispose));
      // A jump chain ends at a forwarding client, not a single resolved SSH
      // host: report the caller's own host if it gave one, else the last hop.
      const host: PluginSshHost = chainOptions?.forHost
        ? (redactHostSecrets(
            chainOptions.forHost as unknown as Record<string, unknown>,
          ) as unknown as PluginSshHost)
        : {
            id: jumpHosts[jumpHosts.length - 1]?.hostId ?? 0,
            ip: "",
            port: 22,
            username: "",
          };
      return { client: client as never, jumpClient: null, host, dispose };
    },

    poolKey,

    dropPooled: (pool, hostId) => {
      const keys = [...poolKeys.entries()]
        .filter(([key, id]) => id === hostId && key.startsWith(`${pool}:`))
        .map(([key]) => key);
      if (keys.length === 0) return;
      for (const key of keys) poolKeys.delete(key);
      void import("../hosts/ssh-connection-pool.js").then(
        ({ connectionPool }) => {
          for (const key of keys) connectionPool.clearKeyConnections(key);
        },
      );
    },

    resolveHost: async (hostId, options) => {
      await checkSsh(true);
      const userId = actingUser();
      const { resolveHostById, resolveHostBySyncId } =
        await import("../hosts/host-resolver.js");
      const resolved = options?.syncId
        ? await resolveHostBySyncId(options.syncId, userId)
        : await resolveHostById(hostId, userId);
      await audit("ssh_resolve_host", describeHost(hostId), {
        success: !!resolved,
        errorMessage: resolved ? undefined : "Host not found",
      });
      if (!resolved) return null;
      // The secrets only go to a plugin that declared it reads them.
      if (await hasCapability(pluginId, "credentials:read", declared)) {
        await audit("credentials_read", describeHost(hostId), {
          success: true,
        });
        const full = resolved as unknown as SshConnectHost;
        remember(full, full, userId);
        return full as unknown as PluginSshHost;
      }
      return handOut(resolved as unknown as SshConnectHost, userId);
    },

    // The config it returns carries the password and private key, so it
    // needs credentials:read on top of the connect pair.
    prepare: async (host, options) => {
      await checkSsh(true);
      await assertCapability(pluginId, "credentials:read", declared);
      const userId = userFor(host);
      const target = toConnectHost(host, userId) as SshConnectHost;
      const { buildConnectConfig } =
        await import("../hosts/connect/build-connect-config.js");
      const built = await buildConnectConfig(target, {
        userId,
        purpose: purposeOf(options),
        profile: profileOf(options),
        client: options.client as never,
        serverHostId: options.serverHostId,
        log: options.log,
        interactive: options.interactive,
        hostKeySocket: (options.hostKeySocket ?? null) as never,
      });
      await audit("ssh_prepare", describeHost(host), {
        success: built.outcome.status === "ready",
        errorMessage:
          built.outcome.status === "ready" ? undefined : built.outcome.message,
      });
      const provider = built.provider;
      return {
        config: built.config,
        outcome: built.outcome,
        authType: provider?.type ?? null,
        onBanner: provider?.onBanner
          ? (banner: string) =>
              provider.onBanner!(banner, target, built.env) as never
          : undefined,
        onAuthFailed: provider?.onAuthFailed
          ? (context) => provider.onAuthFailed!(target, built.env, context)
          : undefined,
      };
    },

    openTransport: async (host, config, transportOptions) => {
      await checkSsh(true);
      const target = toConnectHost(host, userFor(host)) as SshConnectHost;
      const { openSshTransport } =
        await import("../hosts/connect/transport.js");
      let opened: Awaited<ReturnType<typeof openSshTransport>>;
      try {
        opened = await openSshTransport(
          target,
          config as MutableConnectConfig,
          transportOptions,
        );
      } catch (error) {
        await audit("ssh_open_transport", describeHost(host), {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      await audit("ssh_open_transport", describeHost(host), { success: true });
      if (opened.jumpClient) {
        const jumpClient = opened.jumpClient;
        const dispose = () => {
          open.delete(dispose);
          jumpClient.end();
        };
        open.add(dispose);
        jumpClient.once("close", () => open.delete(dispose));
      }
      return opened;
    },

    startInteraction: async (interaction, request) => {
      await checkSsh(true);
      const userId = actingUser();
      ensureCoreSshAuthProviders();
      const { PermissionManager } =
        await import("../utils/permission-manager.js");
      const access = await PermissionManager.getInstance().canAccessHost(
        userId,
        request.hostId,
        "connect",
      );
      if (!access.hasAccess) {
        await audit("ssh_start_interaction", describeHost(request.hostId), {
          success: false,
          errorMessage: "Host not found",
        });
        throw new PluginSshInteractionError("Host not found");
      }
      const { createCurrentHostResolutionRepository } =
        await import("../database/repositories/factory.js");
      const host = await createCurrentHostResolutionRepository().findHostById(
        request.hostId,
        userId,
      );
      if (!host) throw new PluginSshInteractionError("Host not found");

      const own = getSshAuthProvider(host.authType as string);
      const provider =
        own?.interaction === interaction && own.startInteraction
          ? own
          : listSshAuthProviders().find(
              (candidate) =>
                candidate.interaction === interaction &&
                candidate.startInteraction,
            );
      if (!provider?.startInteraction) {
        throw new PluginSshInteractionError(
          `No enabled provider handles ${interaction} sign-in`,
        );
      }
      await audit("ssh_start_interaction", describeHost(request.hostId), {
        success: true,
      });
      await provider.startInteraction({
        userId,
        hostId: request.hostId,
        host: {
          name: host.name as string | null,
          ip: host.ip as string,
          username: host.username as string,
        },
        socket: request.socket as never,
        requestOrigin: request.requestOrigin,
        payload: request.payload ?? {},
      });
    },

    cancelInteraction: async (interaction, request) => {
      await checkSsh(false);
      const userId = actingUser();
      ensureCoreSshAuthProviders();
      for (const provider of listSshAuthProviders()) {
        if (provider.interaction !== interaction) continue;
        if (!provider.cancelInteraction) continue;
        await provider.cancelInteraction({ userId, ...request });
      }
    },

    classifyKeyboardInteractive: (round, host) => {
      ensureCoreSshAuthProviders();
      return classifyKeyboardInteractive(round, host as SshConnectHost);
    },

    autoResponses: (prompts, password) =>
      prompts.map((p) =>
        /password/i.test(p.prompt) && password ? password : "",
      ),

    requiresSecret: (authType) => {
      ensureCoreSshAuthProviders();
      return !!getSshAuthProvider(authType)?.requiresSecret;
    },

    supportsBackground: (authType) => {
      ensureCoreSshAuthProviders();
      const provider = getSshAuthProvider(authType);
      return !!provider && provider.supportsBackground !== false;
    },
  };
}

/**
 * Turns what a plugin method returned into core's identity. Only the fields
 * the SDK documents are copied, so a plugin cannot set core-only extras, and
 * its rate limit key is kept apart from core's and other plugins'.
 */
export function toCoreIdentity(
  pluginId: string,
  identity: PluginVerifiedIdentity,
): VerifiedIdentity {
  if (identity.kind === "user") {
    return {
      kind: "user",
      userId: identity.userId,
      mfaSatisfied: identity.mfaSatisfied,
      password: identity.password,
      returnTo: identity.returnTo,
      rememberMe: identity.rememberMe,
    };
  }
  return {
    kind: "external",
    provider: identity.provider,
    subject: identity.subject,
    email: identity.email,
    name: identity.name,
    groups: identity.groups,
    isAdmin: identity.isAdmin,
    allowedUsers: identity.allowedUsers,
    mfaSatisfied: identity.mfaSatisfied,
    returnTo: identity.returnTo,
    rememberMe: identity.rememberMe,
    legacyIdentifier: identity.legacy?.identifier,
    ssoProviderId:
      identity.logoutClaims?.providerId ??
      identity.legacy?.providerRowId ??
      null,
    oidcSub: identity.logoutClaims?.sub ?? null,
    oidcSid: identity.logoutClaims?.sid ?? null,
    roleSync: identity.roles
      ? {
          desired: [...identity.roles.desired],
          managed: [...identity.roles.managed],
        }
      : undefined,
    rateLimitUsername: identity.rateLimitKey
      ? rateLimitKeyFor(pluginId, identity.rateLimitKey)
      : undefined,
  };
}

function rateLimitKeyFor(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}

export function createPluginAuth({ manifest, bag, audit }: Deps): PluginAuth {
  const pluginId = manifest.id;
  const declared = manifest.capabilities;
  const contributes = manifest.contributes?.auth ?? {};

  // Registration is synchronous so a plugin can call it inline in activate,
  // like ctx.http.router. The declaration is checked here; the grant is
  // checked on every call into what was registered.
  const requireDeclared = (
    list: string[] | undefined,
    id: string,
    field: string,
  ) => {
    if (!declared.includes("auth:provide")) {
      throw capabilityRefused(pluginId, "auth:provide");
    }
    if (!list?.includes(id)) {
      throw new Error(
        `Plugin ${pluginId} cannot register "${id}": it is not listed in contributes.auth.${field}`,
      );
    }
  };

  const granted = () => assertCapability(pluginId, "auth:provide", declared);
  // ssh2 calls some hooks synchronously, so those answer from the grant
  // cache and do nothing until the grant is confirmed.
  const grantedNow = () =>
    hasCachedCapability(pluginId, "auth:provide", declared);

  const record = (action: string, id: string) =>
    void audit(action, `${pluginId} registered ${id}`, { success: true });

  return {
    registerSshAuthProvider: (provider) => {
      requireDeclared(contributes.sshAuthTypes, provider.type, "sshAuthTypes");
      const wrapped: SshAuthProvider = {
        ...(provider as unknown as SshAuthProvider),
        pluginId,
        prepare: async (config, host, env) => {
          await granted();
          return provider.prepare(
            config,
            host as PluginSshHost,
            env as never,
          ) as never;
        },
      };
      if (provider.onBanner) {
        const onBanner = provider.onBanner;
        wrapped.onBanner = (banner, host, env) =>
          grantedNow()
            ? (onBanner(banner, host as PluginSshHost, env as never) as never)
            : (undefined as never);
      }
      if (provider.onAuthFailed) {
        const onAuthFailed = provider.onAuthFailed;
        wrapped.onAuthFailed = (host, env, context) =>
          grantedNow()
            ? (onAuthFailed(
                host as PluginSshHost,
                env as never,
                context as never,
              ) as never)
            : undefined;
      }
      warmPluginGrants(pluginId);
      ensureCoreSshAuthProviders();
      const disposers = [registerSshAuthProvider(wrapped)];
      if (provider.onKeyboardInteractive) {
        const detect = provider.onKeyboardInteractive;
        disposers.push(
          registerKeyboardInteractiveInterceptor({
            id: `${pluginId}:${provider.type}`,
            pluginId,
            detect: (round, host) =>
              host.authType === provider.type && grantedNow()
                ? (detect(round, host as PluginSshHost) as never)
                : null,
          }),
        );
      }
      bag.add(
        () => disposers.forEach((dispose) => dispose()),
        `SSH auth type "${provider.type}"`,
      );
      record("auth_register_ssh", provider.type);
    },

    registerKeyboardInteractiveHandler: (handler) => {
      requireDeclared(
        contributes.keyboardInteractive,
        handler.id,
        "keyboardInteractive",
      );
      // Synchronous hooks inside ssh2's callback, so they answer from the
      // grant cache. Deactivate removes the handler.
      warmPluginGrants(pluginId);
      const settingsFor = (host: SshConnectHost): Record<string, unknown> =>
        host.pluginSettings?.[pluginId] ?? {};
      ensureCoreSshAuthProviders();
      const dispose = registerKeyboardInteractiveInterceptor({
        id: handler.id,
        pluginId,
        detect: (round, host) => {
          if (!grantedNow()) return null;
          const detected = handler.detect(
            round,
            host as PluginSshHost,
            settingsFor(host),
          );
          if (!detected) return null;
          if (detected.kind === "browser") {
            return { ...detected, id: handler.id, label: handler.label };
          }
          return detected;
        },
        autoAnswerPasswords: handler.autoAnswerPasswords
          ? (host) =>
              grantedNow() &&
              handler.autoAnswerPasswords!(
                host as PluginSshHost,
                settingsFor(host),
              ) === true
          : undefined,
      });
      bag.add(dispose, `keyboard-interactive handler "${handler.id}"`);
      record("auth_register_keyboard_interactive", handler.id);
    },

    registerLoginMethod: (method) => {
      requireDeclared(contributes.loginMethods, method.id, "loginMethods");
      {
        const dispose = registerLoginMethod({
          ...method,
          pluginId,
          start: method.start
            ? async (...args) => {
                await granted();
                return method.start!(...args);
              }
            : undefined,
          callback: method.callback
            ? async (...args) => {
                await granted();
                return toCoreIdentity(
                  pluginId,
                  await method.callback!(...args),
                );
              }
            : undefined,
          verify: method.verify
            ? async (...args) => {
                await granted();
                return toCoreIdentity(pluginId, await method.verify!(...args));
              }
            : undefined,
        });
        bag.add(dispose, `login method "${method.id}"`);
      }
      record("auth_register_login", method.id);
    },

    registerSecondFactor: (factor) => {
      requireDeclared(contributes.secondFactors, factor.id, "secondFactors");
      {
        const dispose = registerSecondFactor({
          ...factor,
          pluginId,
          verify: async (userId, body) => {
            await granted();
            return factor.verify(userId, body);
          },
        });
        bag.add(dispose, `second factor "${factor.id}"`);
      }
      record("auth_register_factor", factor.id);
    },

    recordEnrollment: async (userId, factorId) => {
      requireDeclared(contributes.secondFactors, factorId, "secondFactors");
      await granted();
      const { assertSecondFactorEnrollmentAllowed } =
        await import("../auth/core-auth.js");
      assertSecondFactorEnrollmentAllowed();
      const {
        createCurrentSessionRepository,
        createCurrentTrustedDeviceRepository,
        createCurrentUserAuthRepository,
      } = await import("../database/repositories/factory.js");
      await createCurrentUserAuthRepository().recordSecondFactor(
        userId,
        pluginId,
        factorId,
      );
      // A new factor signs the user out everywhere else and forgets trusted
      // devices, so nothing that skipped it before keeps skipping it.
      await createCurrentSessionRepository().revokeAllForUser(
        userId,
        getActor() === userId ? getActorSessionId() : undefined,
      );
      await createCurrentTrustedDeviceRepository().deleteByUserId(userId);
      await audit("auth_factor_enrolled", `${factorId} for ${userId}`, {
        success: true,
      });
    },

    removeEnrollment: async (userId, factorId) => {
      requireDeclared(contributes.secondFactors, factorId, "secondFactors");
      await granted();
      const { createCurrentUserAuthRepository } =
        await import("../database/repositories/factory.js");
      await createCurrentUserAuthRepository().removeSecondFactor(
        userId,
        pluginId,
        factorId,
      );
      await audit("auth_factor_removed", `${factorId} for ${userId}`, {
        success: true,
      });
    },

    completeRedirectLogin: async (methodId, req, res) => {
      requireDeclared(contributes.loginMethods, methodId, "loginMethods");
      await granted();
      const method = getLoginMethod(methodId);
      if (!method || method.pluginId !== pluginId) {
        throw new Error(
          `Plugin ${pluginId} has no registered login method "${methodId}"`,
        );
      }
      const { handleRedirectCallback } =
        await import("../database/routes/auth-routes.js");
      await handleRedirectCallback(method, req as never, res as never);
    },

    revokeSessions: async (match) => {
      await granted();
      if (!match.sub && !match.sid) return 0;
      const { AuthManager } = await import("../utils/auth-manager.js");
      const revoked = await AuthManager.getInstance().revokeSessionsByOidc({
        ssoProviderId: match.providerId ?? null,
        sub: match.sub ?? null,
        sid: match.sid ?? null,
      });
      await audit(
        "auth_sessions_revoked",
        `${revoked} session(s) for provider ${match.providerId ?? "none"}`,
        { success: true },
      );
      return revoked;
    },

    loginRateLimit: {
      isLocked: async (ip, key) => {
        await granted();
        const { loginRateLimiter } =
          await import("../utils/login-rate-limiter.js");
        return loginRateLimiter.isLocked(ip, rateLimitKeyFor(pluginId, key));
      },
      recordFailure: async (ip, key) => {
        await granted();
        const { loginRateLimiter } =
          await import("../utils/login-rate-limiter.js");
        loginRateLimiter.recordFailedAttempt(
          ip,
          rateLimitKeyFor(pluginId, key),
        );
      },
    },

    countLinkedUsers: async (provider) => {
      await granted();
      const { createCurrentUserAuthRepository } =
        await import("../database/repositories/factory.js");
      return createCurrentUserAuthRepository().countUsersForProvider(provider);
    },
  };
}
