import { eq } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

export interface GraphRecord {
  id: number;
  userId: string;
  topology: string | null;
  createdAt: string;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// The table comes from ctx.db.define, which the SDK hands back untyped, and
// the drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type GraphRepository = ReturnType<typeof createGraphRepository>;

/** Per-user network topology storage, one row per user. */
export function createGraphRepository(db: PluginDatabase, table: Table) {
  const client = () => db.client<Drizzle>();

  return {
    async findByUserId(userId: string): Promise<GraphRecord | null> {
      const drizzle = await client();
      const rows = await drizzle
        .select()
        .from(table)
        .where(eq(table.userId, userId))
        .limit(1);
      return (rows[0] as GraphRecord) ?? null;
    },

    async upsertForUser(userId: string, topology: string): Promise<void> {
      const drizzle = await client();
      const now = new Date().toISOString();
      const rows = await drizzle
        .select()
        .from(table)
        .where(eq(table.userId, userId))
        .limit(1);

      if (rows[0]) {
        await drizzle
          .update(table)
          .set({ topology, updatedAt: now })
          .where(eq(table.userId, userId));
      } else {
        await drizzle
          .insert(table)
          .values({ userId, topology, createdAt: now, updatedAt: now });
      }
      await db.persist();
    },
  };
}
