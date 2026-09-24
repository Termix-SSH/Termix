import { and, asc, desc, eq } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { LdapConfig, ProviderRow } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// ctx.db.define hands the table back untyped and the drizzle handle is the
// server's own, so both are typed at this module's edge.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const LEGACY_PREFIXES = ["encoded:", "encrypted:"];

export type ProviderStore = ReturnType<typeof createProviderStore>;

export function createProviderStore(ctx: PluginContext, table: Table) {
  const client = () => ctx.db.client<Drizzle>();

  /** Opens the bind password: sealed, or the 2.8 base64 forms. */
  async function openSecret(value: string): Promise<string> {
    const prefix = LEGACY_PREFIXES.find((p) => value.startsWith(p));
    if (prefix) {
      return Buffer.from(value.slice(prefix.length), "base64").toString("utf8");
    }
    return (await ctx.secrets.unseal(value)) ?? value;
  }

  async function parseConfig(raw: string): Promise<LdapConfig> {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(raw);
    } catch {
      config = {};
    }
    if (typeof config.bindPassword === "string" && config.bindPassword) {
      config.bindPassword = await openSecret(config.bindPassword);
    }
    return config as unknown as LdapConfig;
  }

  async function sealConfig(config: Record<string, unknown>): Promise<string> {
    const out = { ...config };
    if (typeof out.bindPassword === "string" && out.bindPassword) {
      out.bindPassword = await ctx.secrets.seal(out.bindPassword);
    }
    return JSON.stringify(out);
  }

  async function findRow(id: number): Promise<ProviderRow | null> {
    const drizzle = await client();
    const rows = (await drizzle
      .select()
      .from(table)
      .where(eq(table.id, id))
      .limit(1)) as ProviderRow[];
    return rows[0] ?? null;
  }

  return {
    parseConfig,
    findRow,

    async listRows(): Promise<ProviderRow[]> {
      const drizzle = await client();
      return (await drizzle
        .select()
        .from(table)
        .orderBy(asc(table.displayOrder), asc(table.id))) as ProviderRow[];
    },

    async find(id: number): Promise<{
      row: ProviderRow;
      enabled: boolean;
      config: LdapConfig;
    } | null> {
      const row = await findRow(id);
      if (!row) return null;
      return {
        row,
        enabled: !!row.enabled,
        config: await parseConfig(row.config),
      };
    },

    async create(input: {
      name: string;
      enabled: boolean;
      displayOrder: number;
      config: Record<string, unknown>;
    }): Promise<ProviderRow> {
      const drizzle = await client();
      const now = new Date().toISOString();
      await drizzle.insert(table).values({
        name: input.name,
        enabled: input.enabled,
        displayOrder: input.displayOrder,
        config: await sealConfig(input.config),
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.persist();
      // No returning() on every engine: find the row by what was written.
      const rows = (await drizzle
        .select()
        .from(table)
        .where(and(eq(table.name, input.name), eq(table.createdAt, now)))
        .orderBy(desc(table.id))
        .limit(1)) as ProviderRow[];
      return rows[0];
    },

    async update(
      id: number,
      values: Partial<{
        name: string;
        enabled: boolean;
        displayOrder: number;
        config: Record<string, unknown>;
      }>,
    ): Promise<ProviderRow | null> {
      const drizzle = await client();
      const { config, ...rest } = values;
      await drizzle
        .update(table)
        .set({
          ...rest,
          ...(config ? { config: await sealConfig(config) } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(table.id, id));
      await ctx.db.persist();
      return findRow(id);
    },

    async remove(id: number): Promise<void> {
      const drizzle = await client();
      await drizzle.delete(table).where(eq(table.id, id));
      await ctx.db.persist();
    },
  };
}
