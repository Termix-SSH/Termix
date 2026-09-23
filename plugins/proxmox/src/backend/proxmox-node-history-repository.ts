import { and, gte, lte, eq, asc, lt } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

export interface ProxmoxNodeHistoryRow {
  id: number;
  hostId: number;
  ts: string;
  cpuPercent: number | null;
  memPercent: number | null;
  diskPercent: number | null;
  netRxBytes: number | null;
  netTxBytes: number | null;
}

export interface ProxmoxNodeHistoryCreateInput {
  hostId: number;
  cpuPercent: number | null;
  memPercent: number | null;
  diskPercent: number | null;
  netRxBytes: number | null;
  netTxBytes: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ProxmoxNodeHistoryRepository = ReturnType<
  typeof createProxmoxNodeHistoryRepository
>;

export function createProxmoxNodeHistoryRepository(
  db: PluginDatabase,
  table: Table,
) {
  const client = () => db.client<Drizzle>();

  return {
    async create(input: ProxmoxNodeHistoryCreateInput): Promise<void> {
      const drizzle = await client();
      await drizzle.insert(table).values(input);
      await db.persist();
    },

    async listRange(
      hostId: number,
      fromIso: string,
      toIso: string,
    ): Promise<ProxmoxNodeHistoryRow[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(table)
        .where(
          and(
            eq(table.hostId, hostId),
            gte(table.ts, fromIso),
            lte(table.ts, toIso),
          ),
        )
        .orderBy(asc(table.ts));
    },

    async pruneOlderThan(hostId: number, retentionDays: number): Promise<void> {
      // ts columns store CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" UTC, which
      // sorts lexicographically, so the cutoff is a plain string comparison.
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      const drizzle = await client();
      await drizzle
        .delete(table)
        .where(and(eq(table.hostId, hostId), lt(table.ts, cutoff)));
      await db.persist();
    },
  };
}
