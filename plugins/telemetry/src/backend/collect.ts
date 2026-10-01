import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { envOverride } from "./config.js";
import { usageProperty, type UsageCounts, type UsageStore } from "./usage.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// ctx.db hands back the server's own drizzle handle and tables, untyped.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface TelemetrySettings {
  enabled: boolean;
  includePlatform: boolean;
  includeFeatureUsage: boolean;
  includePlugins: boolean;
  instanceId: string;
}

export interface TelemetryPayload {
  event: "instance_heartbeat";
  distinct_id: string;
  properties: Record<string, unknown>;
}

type Env = Record<string, string | undefined>;

export async function readSettings(
  ctx: PluginContext,
): Promise<TelemetrySettings> {
  const all = await ctx.settings.getAll("admin");
  return {
    enabled: all.enabled !== false,
    includePlatform: all.includePlatform !== false,
    includeFeatureUsage: all.includeFeatureUsage !== false,
    includePlugins: all.includePlugins !== false,
    instanceId: typeof all.instanceId === "string" ? all.instanceId : "",
  };
}

/** The env variable decides when set, the admin switch otherwise. */
export function isEnabled(settings: TelemetrySettings, env?: Env): boolean {
  return envOverride(env) ?? settings.enabled;
}

/**
 * Made on first use rather than on activate, so the boot copy of a 2.8
 * instance id is never shadowed by a new one.
 */
export async function ensureInstanceId(ctx: PluginContext): Promise<string> {
  const existing = await ctx.settings.get<string>("instanceId");
  if (existing) return existing;
  const id = randomUUID();
  await ctx.settings.set("instanceId", id);
  return id;
}

export function detectDeployment(
  env: Env = process.env,
  exists: (path: string) => boolean = fs.existsSync,
): "desktop" | "docker" | "server" {
  if (env.ELECTRON_EMBEDDED === "true") return "desktop";
  if (exists("/.dockerenv")) return "docker";
  return "server";
}

async function countRows(ctx: PluginContext): Promise<{
  userCount: number;
  hostCount: number;
}> {
  const { users, hosts } = await ctx.db.refs<{ users: Table; hosts: Table }>();
  const db = await ctx.db.client<Drizzle>();
  const count = async (table: Table) => {
    const rows = await db.select({ count: sql<number>`count(*)` }).from(table);
    return Number(rows[0]?.count ?? 0);
  };
  const [userCount, hostCount] = await Promise.all([
    count(users),
    count(hosts),
  ]);
  return { userCount, hostCount };
}

export interface BuiltPayload {
  payload: TelemetryPayload;
  /** The counts the payload carries, to subtract once it is sent. */
  usage: UsageCounts;
}

export async function buildPayload(
  ctx: PluginContext,
  usage: UsageStore,
  env: Env = process.env,
): Promise<BuiltPayload> {
  const settings = await readSettings(ctx);
  const distinctId = await ensureInstanceId(ctx);
  const { userCount, hostCount } = await countRows(ctx);

  const properties: Record<string, unknown> = {
    version: env.VERSION || "unknown",
    user_count: userCount,
    host_count: hostCount,
  };

  if (settings.includePlatform) {
    properties.os = process.platform;
    properties.arch = process.arch;
    properties.node_version = process.versions.node;
    properties.db_dialect = ctx.db.dialect;
    properties.deployment = detectDeployment(env);
  }

  let carried: UsageCounts = {};
  if (settings.includeFeatureUsage) {
    carried = await usage.read();
    for (const [name, count] of Object.entries(carried)) {
      properties[usageProperty(name)] = count;
    }
  }

  if (settings.includePlugins) {
    const running = (await ctx.plugins.list())
      .filter((plugin) => plugin.state === "active")
      .map((plugin) => plugin.id)
      .sort();
    properties.plugins_enabled = running;
    properties.plugin_count = running.length;
  }

  return {
    payload: {
      event: "instance_heartbeat",
      distinct_id: distinctId,
      properties,
    },
    usage: carried,
  };
}
