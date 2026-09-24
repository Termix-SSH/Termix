import { and, desc, eq, sql } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The table comes from ctx.db.define, which the SDK hands back untyped, and
// the drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type HistoryRepository = ReturnType<typeof createHistoryRepository>;

/** Command history storage. Writes are followed by persist(), reads are not. */
export function createHistoryRepository(db: PluginDatabase, table: Table) {
  const client = () => db.client<Drizzle>();

  return {
    async create(
      userId: string,
      hostId: number,
      command: string,
      executedAt = new Date().toISOString(),
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .insert(table)
        .values({ userId, hostId, command, executedAt });
      await db.persist();
    },

    async listUniqueCommandsForHost(
      userId: string,
      hostId: number,
      limit = 500,
    ): Promise<string[]> {
      const drizzle = await client();
      const rows = await drizzle
        .select({
          command: table.command,
          maxExecutedAt: sql<number>`MAX(${table.executedAt})`,
        })
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.hostId, hostId)))
        .groupBy(table.command)
        .orderBy(desc(sql`MAX(${table.executedAt})`))
        .limit(limit);
      return rows.map((row: { command: string }) => row.command);
    },

    async listCommandsForHost(
      userId: string,
      hostId: number,
      limit = 200,
    ): Promise<Array<{ command: string; executedAt: string }>> {
      const drizzle = await client();
      const rows = await drizzle
        .select({ command: table.command, executedAt: table.executedAt })
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.hostId, hostId)))
        .orderBy(desc(table.executedAt))
        .limit(limit);
      return rows as Array<{ command: string; executedAt: string }>;
    },

    async deleteCommandForHost(
      userId: string,
      hostId: number,
      command: string,
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .delete(table)
        .where(
          and(
            eq(table.userId, userId),
            eq(table.hostId, hostId),
            eq(table.command, command),
          ),
        );
      await db.persist();
    },

    async deleteByUserAndHost(userId: string, hostId: number): Promise<void> {
      const drizzle = await client();
      await drizzle
        .delete(table)
        .where(and(eq(table.userId, userId), eq(table.hostId, hostId)));
      await db.persist();
    },
  };
}
