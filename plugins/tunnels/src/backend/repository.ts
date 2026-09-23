import { and, asc, eq, ne } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

export interface PresetRecord {
  id: number;
  userId: string;
  name: string;
  config: string;
  platform: string | null;
  computerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PresetCreateInput {
  name: string;
  config: string;
  platform?: string | null;
  computerName?: string | null;
}

export type PresetUpdateInput = Partial<PresetCreateInput>;

/* eslint-disable @typescript-eslint/no-explicit-any */
// The table comes from ctx.db.define, which the SDK hands back untyped, and
// the drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type PresetRepository = ReturnType<typeof createPresetRepository>;

/**
 * Per-user client tunnel presets.
 *
 * No RETURNING, so it runs the same on all three engines: a new row is read
 * back as the newest row for that user and name, which the name check before
 * every insert keeps unique.
 */
export function createPresetRepository(db: PluginDatabase, table: Table) {
  const client = () => db.client<Drizzle>();

  async function findByIdForUser(
    userId: string,
    id: number,
  ): Promise<PresetRecord | null> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.userId, userId)))
      .limit(1);
    return (rows[0] as PresetRecord) ?? null;
  }

  return {
    findByIdForUser,

    async listByUserId(userId: string): Promise<PresetRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(table)
        .where(eq(table.userId, userId))
        .orderBy(asc(table.name));
    },

    async hasNameForUser(
      userId: string,
      name: string,
      excludingId?: number,
    ): Promise<boolean> {
      const drizzle = await client();
      const conditions = [eq(table.userId, userId), eq(table.name, name)];
      if (excludingId !== undefined) conditions.push(ne(table.id, excludingId));
      const rows = await drizzle
        .select({ id: table.id })
        .from(table)
        .where(and(...conditions))
        .limit(1);
      return rows.length > 0;
    },

    async createForUser(
      userId: string,
      input: PresetCreateInput,
      now = new Date().toISOString(),
    ): Promise<PresetRecord> {
      const drizzle = await client();
      await drizzle.insert(table).values({
        userId,
        name: input.name,
        config: input.config,
        platform: input.platform ?? null,
        computerName: input.computerName ?? null,
        createdAt: now,
        updatedAt: now,
      });
      await db.persist();
      const rows = await drizzle
        .select()
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.name, input.name)))
        .limit(1);
      return rows[0] as PresetRecord;
    },

    async updateForUser(
      userId: string,
      id: number,
      updates: PresetUpdateInput,
      now = new Date().toISOString(),
    ): Promise<PresetRecord | null> {
      const drizzle = await client();
      await drizzle
        .update(table)
        .set({ ...updates, updatedAt: now })
        .where(and(eq(table.id, id), eq(table.userId, userId)));
      await db.persist();
      return findByIdForUser(userId, id);
    },

    async deleteForUser(userId: string, id: number): Promise<boolean> {
      if (!(await findByIdForUser(userId, id))) return false;
      const drizzle = await client();
      await drizzle
        .delete(table)
        .where(and(eq(table.id, id), eq(table.userId, userId)));
      await db.persist();
      return true;
    },
  };
}
