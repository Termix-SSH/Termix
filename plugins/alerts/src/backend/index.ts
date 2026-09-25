import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { createAnnouncements, REFRESH_MS } from "./announcements.js";
import { createHub } from "./hub.js";
import { readSmtp, sendMail } from "./mail.js";
import { createAlertsRepository } from "./repository.js";
import { registerRoutes } from "./routes.js";
import type { SenderDeps } from "./senders.js";
import { createAlertStream } from "./stream.js";

/** The admin allowlist of private hosts a channel may reach. */
const PRIVATE_ALLOWLIST_KEY = "notification_private_endpoint_allowlist";
const PRUNE_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseAllowlist(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export async function activate(ctx: PluginContext) {
  const repository = await createAlertsRepository(ctx.db, ctx.secrets);
  const stream = createAlertStream();
  ctx.disposables.add(() => stream.closeAll());

  const senders: SenderDeps = {
    fetch: ctx.fetch,
    privateAllowlist: async () =>
      parseAllowlist(await ctx.settings.readCore(PRIVATE_ALLOWLIST_KEY)),
    smtp: () => readSmtp(ctx),
    sendMail,
  };
  const announcements = createAnnouncements(ctx, repository);

  ctx.notify.serve(createHub({ repository, stream, senders }));

  registerRoutes(ctx.http.router<Router>(), {
    ctx,
    repository,
    stream,
    senders,
    announcements,
  });

  ctx.events.on("user.data_wiped", async (payload) => {
    const userId = (payload as { userId?: string } | undefined)?.userId;
    if (userId) await repository.wipeUser(userId);
  });

  const prune = async () => {
    const days = Number(await ctx.settings.get("retentionDays"));
    const keep = Number.isFinite(days) && days >= 1 ? days : 90;
    await repository.pruneItems(
      new Date(Date.now() - keep * DAY_MS).toISOString(),
    );
  };
  ctx.schedule.after(60_000, prune);
  ctx.schedule.every(PRUNE_MS, prune);

  // Users with the app open get a new announcement without reloading.
  ctx.schedule.every(REFRESH_MS, async () => {
    await announcements.refresh();
    for (const userId of stream.users()) {
      const added = await announcements.sync(userId);
      if (added.length === 0) continue;
      for (const item of added) stream.publish(userId, "item", item);
      stream.publish(userId, "unread", {
        count: await repository.unreadCount(userId),
      });
    }
  });
}

export async function deactivate() {}
