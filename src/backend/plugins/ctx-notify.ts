/**
 * ctx.notify and ctx.fetch: core's notification channels and core's guarded
 * outbound HTTP. Channels belong to a user, so notify always runs as the
 * acting user and never sees a channel's config.
 */

import type {
  PluginFetch,
  PluginNotify,
  PluginNotifyResult,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { assertCapability } from "./permissions.js";
import { getActor } from "./actor.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  audit: AuditFn;
}

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

export function createPluginNotify(deps: Deps): PluginNotify {
  const listOwn = async (userId: string) => {
    const { createCurrentNotificationChannelRepository } =
      await import("../database/repositories/factory.js");
    return createCurrentNotificationChannelRepository().listNotificationChannels(
      userId,
    );
  };

  return {
    channels: () =>
      audited(
        deps,
        "notify:send",
        "notify_channels",
        "listed channels",
        async () => {
          const rows = await listOwn(actingUser());
          return rows.map((row) => ({
            id: row.id,
            name: row.name,
            type: row.type,
            enabled: !!row.enabled,
          }));
        },
      ),

    send: (channelIds, notification) =>
      audited(
        deps,
        "notify:send",
        "notify_send",
        `${channelIds.length} channel(s)`,
        async () => {
          const rows = await listOwn(actingUser());
          const { deliverNotification } =
            await import("../utils/notification-sender.js");
          const result: PluginNotifyResult = { delivered: 0, failures: [] };
          for (const row of rows) {
            if (!channelIds.includes(row.id) || !row.enabled) continue;
            try {
              await deliverNotification(row, {
                title: notification.title,
                body: notification.body,
                severity: notification.severity ?? "warning",
                context: notification.context,
              });
              result.delivered++;
            } catch (error) {
              result.failures.push({
                channelId: row.id,
                name: row.name,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          return result;
        },
      ),
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
        );
      } finally {
        clearTimeout(timer);
      }
    });
}
