/**
 * ctx.notify and ctx.fetch: alerts through whichever plugin serves as the
 * hub, and core's guarded outbound HTTP. Core resolves who an alert is for,
 * so a plugin names an audience and never a list of users it could not see.
 */

import type {
  PluginFetch,
  PluginNotification,
  PluginNotificationAudience,
  PluginNotify,
  PluginNotifyResult,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { assertCapability, capabilityRefused } from "./permissions.js";
import { getActor } from "./actor.js";
import { activeNotifyHub, registerNotifyHub } from "./notify-hub.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  audit: AuditFn;
  /** Where serve's revoke goes, so the hub goes away with the plugin. */
  bag?: { add: (dispose: () => void, label: string) => void };
}

const EMPTY_RESULT: PluginNotifyResult = {
  recipients: 0,
  delivered: 0,
  failures: [],
};

function actingUser(): string {
  const actor = getActor();
  if (!actor) {
    throw new Error(
      "ctx.notify needs an acting user: call it inside a request or ctx.asUser",
    );
  }
  return actor;
}

/** Runs fn behind the capability check, with an audit line either way. */
async function audited<T>(
  deps: Deps,
  capability: string,
  action: string,
  details: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    await assertCapability(
      deps.manifest.id,
      capability,
      deps.manifest.capabilities,
    );
    const result = await fn();
    await deps.audit(action, details, { success: true });
    return result;
  } catch (error) {
    await deps.audit(action, details, {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** The user ids an audience names right now. */
export async function resolveAudience(
  audience: PluginNotificationAudience | undefined,
): Promise<string[]> {
  if (!audience) return [actingUser()];
  const { createCurrentUserRepository } =
    await import("../database/repositories/factory.js");
  const users = createCurrentUserRepository();
  if (audience === "admins") {
    return (await users.listAll())
      .filter((user) => user.isAdmin)
      .map((user) => user.id);
  }
  if ("userId" in audience) {
    return (await users.findById(audience.userId)) ? [audience.userId] : [];
  }
  const { PermissionManager } = await import("../utils/permission-manager.js");
  const permissions = PermissionManager.getInstance();
  const recipients: string[] = [];
  for (const user of await users.listAll()) {
    if (await permissions.hasPermission(user.id, audience.permission)) {
      recipients.push(user.id);
    }
  }
  return recipients;
}

function describeAudience(notification: PluginNotification): string {
  const { audience } = notification;
  if (!audience) return "acting user";
  if (audience === "admins") return "admins";
  if ("userId" in audience) return `user ${audience.userId}`;
  return `permission ${audience.permission}`;
}

export function createPluginNotify(deps: Deps): PluginNotify {
  const pluginId = deps.manifest.id;

  return {
    channels: () =>
      audited(
        deps,
        "notify:send",
        "notify_channels",
        "listed channels",
        async () => {
          const userId = actingUser();
          const hub = await activeNotifyHub();
          return hub ? hub.channels(userId) : [];
        },
      ),

    send: (notification) =>
      audited(
        deps,
        "notify:send",
        "notify_send",
        `${notification.category ?? pluginId} to ${describeAudience(notification)}`,
        async () => {
          const recipients = await resolveAudience(notification.audience);
          const hub = await activeNotifyHub();
          if (!hub || recipients.length === 0) return { ...EMPTY_RESULT };
          return hub.deliver({ source: pluginId, recipients, notification });
        },
      ),

    serve: (hub) => {
      if (!deps.manifest.capabilities.includes("notify:hub")) {
        throw capabilityRefused(pluginId, "notify:hub", "notify_serve");
      }
      const revoke = registerNotifyHub({
        pluginId,
        declared: deps.manifest.capabilities,
        hub,
      });
      deps.bag?.add(revoke, "alert hub");
      void deps.audit("notify_serve", "serving alerts", { success: true });
      return revoke;
    },
  };
}

export function createPluginFetch(deps: Deps): PluginFetch {
  return (url, init = {}) =>
    audited(deps, "network:outbound", "fetch", "outbound request", async () => {
      const { safeOutboundFetch } =
        await import("../utils/safe-outbound-fetch.js");
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.max(init.timeoutMs ?? 30_000, 1),
      );
      // The caller's signal keeps working after the headers arrive, so it
      // can stop a streamed body; the timeout only covers the wait for them.
      const onAbort = () => controller.abort();
      if (init.signal?.aborted) controller.abort();
      init.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        return await safeOutboundFetch(
          url,
          {
            method: init.method ?? "GET",
            headers: init.headers,
            body: init.body,
            signal: controller.signal,
          },
          (init.allowPrivateHosts ?? []).map((host) => host.toLowerCase()),
          {
            ...(init.tls?.ca ? { ca: init.tls.ca } : {}),
            ...(init.tls?.rejectUnauthorized === false
              ? { rejectUnauthorized: false }
              : {}),
          },
        );
      } finally {
        clearTimeout(timer);
      }
    });
}
