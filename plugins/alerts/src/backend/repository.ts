import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import type { PluginDatabase, PluginSecrets } from "@termix/plugin-sdk/backend";
import {
  CHANNEL_TYPES,
  isSeverity,
  type AlertItem,
  type AlertLink,
  type AlertRule,
  type ChannelDetail,
  type ChannelSummary,
  type ChannelType,
  type DeliveryResult,
  type Severity,
} from "../types.js";
import {
  channels as channelsDef,
  dismissed as dismissedDef,
  items as itemsDef,
  rules as rulesDef,
} from "./tables.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Tables come from ctx.db.define, which the SDK hands back untyped, and the
// drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
type Row = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface NewItem {
  userId: string;
  source: string;
  category: string;
  severity: Severity;
  title: string;
  body?: string | null;
  link?: AlertLink | null;
  context?: Record<string, unknown> | null;
  dedupeKey?: string | null;
  createdAt?: string;
}

export interface ItemFilter {
  unread?: boolean;
  source?: string;
  severity?: Severity;
  limit?: number;
  beforeId?: number;
}

/** A channel with its config opened, for delivery. */
export interface DeliverableChannel {
  id: number;
  name: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

export type AlertsRepository = Awaited<
  ReturnType<typeof createAlertsRepository>
>;

type Sealer = Pick<PluginSecrets, "seal" | "unseal">;

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function asChannelType(value: unknown): ChannelType {
  return (CHANNEL_TYPES as readonly string[]).includes(String(value))
    ? (value as ChannelType)
    : "webhook";
}

function toItem(row: Row): AlertItem {
  return {
    id: Number(row.id),
    source: row.source,
    category: row.category,
    severity: isSeverity(row.severity) ? row.severity : "info",
    title: row.title,
    body: row.body ?? null,
    link: parseJson<AlertLink>(row.link),
    context: parseJson<Record<string, unknown>>(row.context),
    deliveries: parseJson<DeliveryResult[]>(row.deliveries),
    readAt: row.readAt ?? null,
    createdAt: String(row.createdAt),
  };
}

function toRule(row: Row): AlertRule {
  const channelIds = parseJson<unknown[]>(row.channelIds) ?? [];
  return {
    id: Number(row.id),
    name: row.name,
    match: row.pattern,
    minSeverity: isSeverity(row.minSeverity) ? row.minSeverity : "warning",
    channelIds: channelIds.map(Number).filter(Number.isInteger),
    enabled: !!row.enabled,
  };
}

export async function createAlertsRepository(
  db: PluginDatabase,
  secrets: Sealer,
) {
  const channels: Table = await db.define(channelsDef);
  const items: Table = await db.define(itemsDef);
  const rules: Table = await db.define(rulesDef);
  const dismissed: Table = await db.define(dismissedDef);

  const client = () => db.client<Drizzle>();

  /** Inserts one row and returns its id. MySQL has no RETURNING. */
  async function insertId(
    table: Table,
    values: Record<string, unknown>,
  ): Promise<number> {
    const drizzle = await client();
    if (db.dialect === "mysql") {
      const result = await drizzle.insert(table).values(values);
      const header = Array.isArray(result) ? result[0] : result;
      return Number(header?.insertId);
    }
    const rows = await drizzle
      .insert(table)
      .values(values)
      .returning({ id: table.id });
    return Number(rows[0].id);
  }

  /** Null when the config was never sealed here, i.e. still waiting on its upgrade. */
  async function openConfig(
    stored: string | null,
  ): Promise<Record<string, unknown> | null> {
    if (!stored) return null;
    const plain = await secrets.unseal(stored);
    return plain ? parseJson<Record<string, unknown>>(plain) : null;
  }

  async function summarize(row: Row): Promise<ChannelSummary> {
    return {
      id: Number(row.id),
      name: row.name,
      type: asChannelType(row.type),
      enabled: !!row.enabled,
      createdAt: String(row.createdAt),
      usable: (await openConfig(row.config)) !== null,
    };
  }

  async function channelRows(userId: string): Promise<Row[]> {
    const drizzle = await client();
    return drizzle
      .select()
      .from(channels)
      .where(eq(channels.userId, userId))
      .orderBy(channels.id);
  }

  async function findChannelRow(
    userId: string,
    id: number,
  ): Promise<Row | null> {
    const drizzle = await client();
    const [row] = await drizzle
      .select()
      .from(channels)
      .where(and(eq(channels.id, id), eq(channels.userId, userId)));
    return row ?? null;
  }

  const repository = {
    async listChannels(userId: string): Promise<ChannelSummary[]> {
      return Promise.all((await channelRows(userId)).map(summarize));
    },

    async getChannel(
      userId: string,
      id: number,
    ): Promise<ChannelDetail | null> {
      const row = await findChannelRow(userId, id);
      if (!row) return null;
      const config = await openConfig(row.config);
      return {
        ...(await summarize(row)),
        config: config ?? {},
      };
    },

    async deliverableChannels(userId: string): Promise<DeliverableChannel[]> {
      const rows = await channelRows(userId);
      return Promise.all(
        rows.map(async (row) => ({
          id: Number(row.id),
          name: row.name,
          type: asChannelType(row.type),
          enabled: !!row.enabled,
          config: await openConfig(row.config),
        })),
      );
    },

    async createChannel(
      userId: string,
      input: {
        name: string;
        type: ChannelType;
        config: Record<string, unknown>;
        enabled?: boolean;
      },
    ): Promise<number> {
      const now = new Date().toISOString();
      const id = await insertId(channels, {
        userId,
        name: input.name,
        type: input.type,
        config: await secrets.seal(JSON.stringify(input.config)),
        enabled: input.enabled !== false,
        createdAt: now,
        updatedAt: now,
      });
      await db.persist();
      return id;
    },

    async updateChannel(
      userId: string,
      id: number,
      patch: {
        name?: string;
        type?: ChannelType;
        config?: Record<string, unknown>;
        enabled?: boolean;
      },
    ): Promise<boolean> {
      if (!(await findChannelRow(userId, id))) return false;
      const values: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.type !== undefined) values.type = patch.type;
      if (patch.enabled !== undefined) values.enabled = patch.enabled;
      if (patch.config !== undefined) {
        values.config = await secrets.seal(JSON.stringify(patch.config));
      }
      const drizzle = await client();
      await drizzle
        .update(channels)
        .set(values)
        .where(and(eq(channels.id, id), eq(channels.userId, userId)));
      await db.persist();
      return true;
    },

    async deleteChannel(userId: string, id: number): Promise<boolean> {
      if (!(await findChannelRow(userId, id))) return false;
      const drizzle = await client();
      await drizzle
        .delete(channels)
        .where(and(eq(channels.id, id), eq(channels.userId, userId)));
      // Rules keep working with the channels they still name.
      for (const rule of await repository.listRules(userId)) {
        if (!rule.channelIds.includes(id)) continue;
        await drizzle
          .update(rules)
          .set({
            channelIds: JSON.stringify(
              rule.channelIds.filter((channelId) => channelId !== id),
            ),
          })
          .where(eq(rules.id, rule.id));
      }
      await db.persist();
      return true;
    },

    async insertItem(item: NewItem): Promise<AlertItem> {
      const createdAt = item.createdAt ?? new Date().toISOString();
      const id = await insertId(items, {
        userId: item.userId,
        source: item.source,
        category: item.category,
        severity: item.severity,
        title: item.title,
        body: item.body ?? null,
        link: item.link ? JSON.stringify(item.link) : null,
        context: item.context ? JSON.stringify(item.context) : null,
        dedupeKey: item.dedupeKey ?? null,
        createdAt,
      });
      await db.persist();
      return toItem({
        id,
        ...item,
        link: item.link ? JSON.stringify(item.link) : null,
        context: item.context ? JSON.stringify(item.context) : null,
        deliveries: null,
        readAt: null,
        createdAt,
      });
    },

    async setDeliveries(id: number, results: DeliveryResult[]): Promise<void> {
      const drizzle = await client();
      await drizzle
        .update(items)
        .set({ deliveries: JSON.stringify(results) })
        .where(eq(items.id, id));
      await db.persist();
    },

    async hasUnreadWithKey(userId: string, key: string): Promise<boolean> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.userId, userId),
            eq(items.dedupeKey, key),
            isNull(items.readAt),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async hasItemWithKey(userId: string, key: string): Promise<boolean> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.userId, userId), eq(items.dedupeKey, key)))
        .limit(1);
      return rows.length > 0;
    },

    async listItems(
      userId: string,
      filter: ItemFilter = {},
    ): Promise<AlertItem[]> {
      const conditions = [eq(items.userId, userId)];
      if (filter.unread) conditions.push(isNull(items.readAt));
      if (filter.source) conditions.push(eq(items.source, filter.source));
      if (filter.severity) conditions.push(eq(items.severity, filter.severity));
      if (filter.beforeId) conditions.push(lt(items.id, filter.beforeId));
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(items)
        .where(and(...conditions))
        .orderBy(desc(items.id))
        .limit(Math.min(Math.max(filter.limit ?? 50, 1), 200));
      return rows.map(toItem);
    },

    async getItem(userId: string, id: number): Promise<AlertItem | null> {
      const drizzle = await client();
      const [row] = await drizzle
        .select()
        .from(items)
        .where(and(eq(items.id, id), eq(items.userId, userId)));
      return row ? toItem(row) : null;
    },

    async unreadCount(userId: string): Promise<number> {
      const drizzle = await client();
      const [row] = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(items)
        .where(and(eq(items.userId, userId), isNull(items.readAt)));
      return Number(row?.count ?? 0);
    },

    async setRead(
      userId: string,
      ids: number[] | "all",
      read: boolean,
    ): Promise<void> {
      const conditions = [eq(items.userId, userId)];
      if (ids !== "all") {
        if (ids.length === 0) return;
        conditions.push(inArray(items.id, ids));
      }
      conditions.push(read ? isNull(items.readAt) : isNotNull(items.readAt));
      const drizzle = await client();
      await drizzle
        .update(items)
        .set({ readAt: read ? new Date().toISOString() : null })
        .where(and(...conditions));
      await db.persist();
    },

    async deleteItem(userId: string, id: number): Promise<AlertItem | null> {
      const item = await repository.getItem(userId, id);
      if (!item) return null;
      const drizzle = await client();
      await drizzle
        .delete(items)
        .where(and(eq(items.id, id), eq(items.userId, userId)));
      await db.persist();
      return item;
    },

    /** Deletes the user's read alerts, or every alert. Returns what went. */
    async clearItems(userId: string, onlyRead: boolean): Promise<AlertItem[]> {
      const conditions = [eq(items.userId, userId)];
      if (onlyRead) conditions.push(isNotNull(items.readAt));
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(items)
        .where(and(...conditions));
      if (rows.length === 0) return [];
      await drizzle.delete(items).where(and(...conditions));
      await db.persist();
      return rows.map(toItem);
    },

    async pruneItems(olderThan: string): Promise<void> {
      const drizzle = await client();
      await drizzle.delete(items).where(lt(items.createdAt, olderThan));
      await db.persist({ lazy: true });
    },

    /** Every source and category the user has alerts from, for the rule editor. */
    async listCategories(
      userId: string,
    ): Promise<Array<{ source: string; category: string }>> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .selectDistinct({ source: items.source, category: items.category })
        .from(items)
        .where(eq(items.userId, userId));
      return rows
        .map((row) => ({ source: row.source, category: row.category }))
        .sort((a, b) => a.category.localeCompare(b.category));
    },

    async listRules(userId: string): Promise<AlertRule[]> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select()
        .from(rules)
        .where(eq(rules.userId, userId))
        .orderBy(rules.id);
      return rows.map(toRule);
    },

    async createRule(
      userId: string,
      input: Omit<AlertRule, "id">,
    ): Promise<number> {
      const id = await insertId(rules, {
        userId,
        name: input.name,
        pattern: input.match,
        minSeverity: input.minSeverity,
        channelIds: JSON.stringify(input.channelIds),
        enabled: input.enabled,
        createdAt: new Date().toISOString(),
      });
      await db.persist();
      return id;
    },

    async updateRule(
      userId: string,
      id: number,
      input: Omit<AlertRule, "id">,
    ): Promise<boolean> {
      const drizzle = await client();
      const [row] = await drizzle
        .select({ id: rules.id })
        .from(rules)
        .where(and(eq(rules.id, id), eq(rules.userId, userId)));
      if (!row) return false;
      await drizzle
        .update(rules)
        .set({
          name: input.name,
          pattern: input.match,
          minSeverity: input.minSeverity,
          channelIds: JSON.stringify(input.channelIds),
          enabled: input.enabled,
        })
        .where(and(eq(rules.id, id), eq(rules.userId, userId)));
      await db.persist();
      return true;
    },

    async deleteRule(userId: string, id: number): Promise<boolean> {
      const drizzle = await client();
      const [row] = await drizzle
        .select({ id: rules.id })
        .from(rules)
        .where(and(eq(rules.id, id), eq(rules.userId, userId)));
      if (!row) return false;
      await drizzle
        .delete(rules)
        .where(and(eq(rules.id, id), eq(rules.userId, userId)));
      await db.persist();
      return true;
    },

    async dismissedIds(userId: string): Promise<Set<string>> {
      const drizzle = await client();
      const rows: Row[] = await drizzle
        .select({ alertId: dismissed.alertId })
        .from(dismissed)
        .where(eq(dismissed.userId, userId));
      return new Set(rows.map((row) => String(row.alertId)));
    },

    async dismiss(userId: string, alertId: string): Promise<void> {
      if ((await repository.dismissedIds(userId)).has(alertId)) return;
      const drizzle = await client();
      await drizzle.insert(dismissed).values({
        userId,
        alertId,
        dismissedAt: new Date().toISOString(),
      });
      await db.persist();
    },

    /** A user's data was wiped: nothing of theirs stays. */
    async wipeUser(userId: string): Promise<void> {
      const drizzle = await client();
      for (const table of [items, rules, channels, dismissed]) {
        await drizzle.delete(table).where(eq(table.userId, userId));
      }
      await db.persist();
    },
  };
  return repository;
}
