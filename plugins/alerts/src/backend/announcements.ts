import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  ANNOUNCEMENT_SOURCE,
  type AlertItem,
  type Severity,
} from "../types.js";
import type { AlertsRepository } from "./repository.js";

export const FEED_URL =
  "https://raw.githubusercontent.com/Termix-SSH/Docs/main/termix-alerts.json";
export const REFRESH_MS = 30 * 60 * 1000;
export const ANNOUNCEMENT_CATEGORY = "termix.announcement";

/** One entry of termix-alerts.json, as the Docs repo publishes it. */
export interface Announcement {
  id: string;
  title: string;
  message: string;
  expiresAt?: string;
  priority?: "low" | "medium" | "high" | "critical";
  type?: "info" | "warning" | "error" | "success";
  actionUrl?: string;
  actionText?: string;
}

export function announcementSeverity(entry: Announcement): Severity {
  if (entry.priority === "critical" || entry.type === "error") {
    return "critical";
  }
  if (entry.type === "warning" || entry.priority === "high") return "warning";
  if (entry.type === "success") return "success";
  return "info";
}

export function parseFeed(raw: unknown, now = Date.now()): Announcement[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is Announcement => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== "string" || !candidate.id) return false;
    if (typeof candidate.title !== "string") return false;
    if (typeof candidate.expiresAt === "string") {
      const expires = Date.parse(candidate.expiresAt);
      if (Number.isFinite(expires) && expires <= now) return false;
    }
    return true;
  });
}

const dedupeKey = (id: string) => `announcement:${id}`;

/**
 * Termix announcements from the Docs repo, brought into each user's inbox
 * the first time they look after one is published. A user who deletes one
 * never gets it back.
 */
export function createAnnouncements(
  ctx: PluginContext,
  repository: AlertsRepository,
) {
  let feed: Announcement[] = [];
  let fetchedAt = 0;
  let refreshing: Promise<void> | null = null;
  const syncing = new Map<string, Promise<AlertItem[]>>();

  async function enabled(): Promise<boolean> {
    return (await ctx.settings.get<boolean>("announcements")) !== false;
  }

  async function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const response = await ctx.fetch(FEED_URL, {
          headers: {
            Accept: "application/json",
            "User-Agent": "TermixAlertChecker/1.0",
          },
          timeoutMs: 15_000,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        feed = parseFeed(await response.json());
      } catch (error) {
        ctx.log.warn(
          `Could not fetch Termix announcements: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        fetchedAt = Date.now();
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function current(): Promise<Announcement[]> {
    if (!(await enabled())) return [];
    if (Date.now() - fetchedAt > REFRESH_MS) await refresh();
    return parseFeed(feed);
  }

  async function syncUser(userId: string): Promise<AlertItem[]> {
    const added: AlertItem[] = [];
    const active = await current();
    if (active.length === 0) return added;
    const dismissed = await repository.dismissedIds(userId);
    for (const entry of active) {
      if (dismissed.has(entry.id)) continue;
      if (await repository.hasItemWithKey(userId, dedupeKey(entry.id))) {
        continue;
      }
      added.push(
        await repository.insertItem({
          userId,
          source: ANNOUNCEMENT_SOURCE,
          category: ANNOUNCEMENT_CATEGORY,
          severity: announcementSeverity(entry),
          title: entry.title.slice(0, 200),
          body: typeof entry.message === "string" ? entry.message : null,
          link:
            typeof entry.actionUrl === "string" &&
            /^https?:\/\//i.test(entry.actionUrl)
              ? { url: entry.actionUrl }
              : null,
          context: {
            announcementId: entry.id,
            ...(entry.actionText ? { actionText: entry.actionText } : {}),
          },
          dedupeKey: dedupeKey(entry.id),
        }),
      );
    }
    return added;
  }

  return {
    refresh,

    /** Adds any announcement the user has not seen yet. Returns what was added. */
    sync(userId: string): Promise<AlertItem[]> {
      const running = syncing.get(userId);
      if (running) return running;
      const run = syncUser(userId)
        .catch((error) => {
          ctx.log.warn(
            `Could not add announcements to the inbox: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [] as AlertItem[];
        })
        .finally(() => syncing.delete(userId));
      syncing.set(userId, run);
      return run;
    },

    /** Remembers that the user removed an announcement from their inbox. */
    async forget(userId: string, item: AlertItem): Promise<void> {
      const id = item.context?.announcementId;
      if (item.source === ANNOUNCEMENT_SOURCE && typeof id === "string") {
        await repository.dismiss(userId, id);
      }
    },
  };
}

export type Announcements = ReturnType<typeof createAnnouncements>;
