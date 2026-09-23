/**
 * ctx.ssh and ctx.auth.
 *
 * ctx.ssh is a thin, capability-checked door onto core's connect pipeline.
 * ctx.auth registers login methods, second factors and SSH auth types into
 * core's registries, scoped to the plugin's manifest and its disposable bag.
 */

import type {
  PluginAuth,
  PluginSsh,
  PluginSshConnectOptions,
  PluginSshHost,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { assertCapability } from "./permissions.js";
import { getActor } from "./actor.js";
import type { DisposableBag } from "./disposables.js";
import {
  getSshAuthProvider,
  registerKeyboardInteractiveInterceptor,
  registerSshAuthProvider,
} from "../hosts/connect/auth-provider-registry.js";
import { classifyKeyboardInteractive } from "../hosts/connect/keyboard-interactive.js";
import { ensureCoreSshAuthProviders } from "../hosts/connect/core-providers.js";
import { registerLoginMethod, registerSecondFactor } from "../auth/registry.js";
import type {
  MutableConnectConfig,
  SshAuthProvider,
  SshConnectHost,
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

const PLUGIN_PURPOSES = new Set<SshConnectPurpose>([
  "plugin",
  "docker",
  "docker-console",
  "metrics",
  "proxmox",
  "fleet",
  "remote-desktop",
  "tunnel",
  "file-manager",
  "file-transfer",
]);

function purposeOf(options?: PluginSshConnectOptions): SshConnectPurpose {
  const purpose = (options?.purpose ?? "plugin") as SshConnectPurpose;
  return PLUGIN_PURPOSES.has(purpose) ? purpose : "plugin";
}

/**
 * The user a connection runs as: the request's actor, or for background work
 * on a resolved host, that host's owner. A bare host id with no actor has
 * nobody to resolve it for.
 */
function actingUser(host: number | PluginSshHost): string {
  const actor = getActor();
  if (actor) return actor;
  if (typeof host === "object" && host.userId) return host.userId;
  throw new Error(
    "ctx.ssh needs an acting user: call it inside a request, ctx.asUser, or pass a resolved host",
  );
}

function describeHost(host: number | PluginSshHost): string {
  return typeof host === "number" ? `host ${host}` : `host ${host.id}`;
}

export function createPluginSsh({ manifest, bag, audit }: Deps): PluginSsh {
  const pluginId = manifest.id;
  const declared = manifest.capabilities;
  const open = new Set<() => void>();
  const poolKeys = new Set<string>();

  bag.add(async () => {
    for (const dispose of [...open]) dispose();
    open.clear();
    if (poolKeys.size > 0) {
      const { connectionPool } =
        await import("../hosts/ssh-connection-pool.js");
      for (const key of poolKeys) connectionPool.clearKeyConnections(key);
      poolKeys.clear();
    }
  }, "SSH connections");

  const checkSsh = async (withCredentials: boolean) => {
    await assertCapability(pluginId, "ssh:connect", declared);
    if (withCredentials) {
      await assertCapability(pluginId, "credentials:use", declared);
    }
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

    const userId = actingUser(host);
    const { connectHost } = await import("../hosts/connect/connect-host.js");
    try {
      const connection = await connectHost(host as number | SshConnectHost, {
        userId,
        purpose: purposeOf(options),
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
        host: connection.host as unknown as PluginSshHost,
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
      const resolved = await resolveConnectHost(
        host as number | SshConnectHost,
        actingUser(host),
      );
      const key = poolKey(options.pool, resolved as PluginSshHost);
      poolKeys.add(key);
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
      const userId = actingUser(chainOptions?.forHost ?? 0);
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
      const host: PluginSshHost = chainOptions?.forHost ?? {
        id: jumpHosts[jumpHosts.length - 1]?.hostId ?? 0,
        ip: "",
        port: 22,
        username: "",
      };
      return { client: client as never, jumpClient: null, host, dispose };
    },

    poolKey,

    prepare: async (host, options) => {
      await checkSsh(true);
      const { buildConnectConfig } =
        await import("../hosts/connect/build-connect-config.js");
      const built = await buildConnectConfig(host as SshConnectHost, {
        userId: actingUser(host),
        purpose: purposeOf(options),
        client: options.client as never,
        serverHostId: options.serverHostId,
        log: options.log,
      });
      await audit("ssh_prepare", describeHost(host), {
        success: built.outcome.status === "ready",
        errorMessage:
          built.outcome.status === "ready" ? undefined : built.outcome.message,
      });
      return { config: built.config, outcome: built.outcome };
    },

    openTransport: async (host, config) => {
      await checkSsh(false);
      const { openSshTransport } =
        await import("../hosts/connect/transport.js");
      const opened = await openSshTransport(
        host as SshConnectHost,
        config as MutableConnectConfig,
      );
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
      throw new PluginCapabilityError(pluginId, "auth:provide");
    }
    if (!list?.includes(id)) {
      throw new Error(
        `Plugin ${pluginId} cannot register "${id}": it is not listed in contributes.auth.${field}`,
      );
    }
  };

  const granted = () => assertCapability(pluginId, "auth:provide", declared);

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
          onBanner(banner, host as PluginSshHost, env as never) as never;
      }
      ensureCoreSshAuthProviders();
      const disposers = [registerSshAuthProvider(wrapped)];
      if (provider.onKeyboardInteractive) {
        const detect = provider.onKeyboardInteractive;
        disposers.push(
          registerKeyboardInteractiveInterceptor({
            id: `${pluginId}:${provider.type}`,
            pluginId,
            detect: (round, host) =>
              host.authType === provider.type
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
                return method.callback!(...args);
              }
            : undefined,
          verify: method.verify
            ? async (...args) => {
                await granted();
                return method.verify!(...args);
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
      const { createCurrentUserAuthRepository } =
        await import("../database/repositories/factory.js");
      await createCurrentUserAuthRepository().recordSecondFactor(
        userId,
        pluginId,
        factorId,
      );
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
  };
}
