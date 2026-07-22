import crypto from "crypto";
import axios from "axios";
import { sql } from "drizzle-orm";
import { users, hosts, recentActivity } from "../database/db/schema.js";
import {
  createCurrentSettingsRepository,
  createCurrentRepositoryContext,
} from "../database/repositories/factory.js";
import { Logger } from "./logger.js";

export const analyticsLogger = new Logger("ANALYTICS", "📈", "#06b6d4");

const FEATURE_ACTIVITY_TYPES = [
  "terminal",
  "file_manager",
  "tunnel",
  "docker",
  "telnet",
  "vnc",
  "rdp",
  "server_stats",
] as const;

const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function isAnalyticsEnabled(): Promise<boolean> {
  return createCurrentSettingsRepository().getBoolean(
    "analytics_enabled",
    true,
  );
}

export async function getOrCreateInstanceId(): Promise<string> {
  const settings = createCurrentSettingsRepository();
  const existing = await settings.get("analytics_instance_id");
  if (existing) return existing;

  const id = crypto.randomUUID();
  await settings.set("analytics_instance_id", id);
  return id;
}

function getAppVersion(): string {
  return process.env.VERSION || "unknown";
}

async function collectFeatureUsage(): Promise<Record<string, number>> {
  const since = new Date(Date.now() - HEARTBEAT_INTERVAL_MS).toISOString();
  const db = createCurrentRepositoryContext().drizzle;

  const rows = await db
    .select({
      type: recentActivity.type,
      count: sql<number>`count(*)`,
    })
    .from(recentActivity)
    .where(sql`${recentActivity.timestamp} >= ${since}`)
    .groupBy(recentActivity.type);

  const counts = new Map(rows.map((row) => [row.type, Number(row.count)]));
  const usage: Record<string, number> = {};
  for (const type of FEATURE_ACTIVITY_TYPES) {
    usage[`used_${type}`] = counts.get(type) ?? 0;
  }
  return usage;
}

async function collectCounts(): Promise<{
  userCount: number;
  hostCount: number;
}> {
  const db = createCurrentRepositoryContext().drizzle;

  const [userRows, hostRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(users),
    db.select({ count: sql<number>`count(*)` }).from(hosts),
  ]);

  return {
    userCount: Number(userRows[0]?.count ?? 0),
    hostCount: Number(hostRows[0]?.count ?? 0),
  };
}

export async function collectAndSendHeartbeat(): Promise<void> {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return;

  try {
    if (!(await isAnalyticsEnabled())) return;

    const instanceId = await getOrCreateInstanceId();
    const { userCount, hostCount } = await collectCounts();
    const featureUsage = await collectFeatureUsage();

    await axios.post(
      `${POSTHOG_HOST}/capture/`,
      {
        api_key: apiKey,
        event: "instance_heartbeat",
        distinct_id: instanceId,
        properties: {
          version: getAppVersion(),
          user_count: userCount,
          host_count: hostCount,
          ...featureUsage,
        },
      },
      { timeout: 10000 },
    );

    analyticsLogger.info("Sent daily usage heartbeat", {
      operation: "analytics_heartbeat_sent",
    });
  } catch (err) {
    analyticsLogger.warn("Failed to send usage heartbeat", {
      operation: "analytics_heartbeat_failed",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export function startAnalyticsHeartbeat(): void {
  if (!process.env.POSTHOG_API_KEY) {
    analyticsLogger.info("Analytics disabled: POSTHOG_API_KEY not set", {
      operation: "analytics_disabled_no_key",
    });
    return;
  }

  void collectAndSendHeartbeat();
  setInterval(() => void collectAndSendHeartbeat(), HEARTBEAT_INTERVAL_MS);
}
