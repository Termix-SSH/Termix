import { and, eq } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";
import { maintenanceTable } from "./tables.js";
import { emptyMaintenance, type HostMaintenance } from "../maintenance.js";

export interface MaintenanceRow {
  userId: string;
  hostId: number;
  state: HostMaintenance;
}
export type MaintenanceRepository = Awaited<
  ReturnType<typeof createMaintenanceRepository>
>;

export async function createMaintenanceRepository(db: PluginDatabase) {
  // The SDK constructs dialect-specific tables at runtime.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const table: any = await db.define(maintenanceTable);
  const client = () => db.client<any>();
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const where = (userId: string, hostId: number) =>
    and(eq(table.userId, userId), eq(table.hostId, hostId));
  return {
    async read(userId: string, hostId: number): Promise<HostMaintenance> {
      const rows = await (
        await client()
      )
        .select()
        .from(table)
        .where(where(userId, hostId));
      return rows.length ? JSON.parse(rows[0].state) : emptyMaintenance();
    },
    async write(
      userId: string,
      hostId: number,
      state: HostMaintenance,
    ): Promise<void> {
      const connection = await client();
      const rows = await connection
        .select({ id: table.id })
        .from(table)
        .where(where(userId, hostId));
      const values = { state: JSON.stringify(state) };
      if (rows.length)
        await connection.update(table).set(values).where(where(userId, hostId));
      else await connection.insert(table).values({ userId, hostId, ...values });
      await db.persist();
    },
    async list(userId?: string): Promise<MaintenanceRow[]> {
      const query = (await client()).select().from(table);
      const rows = await (userId
        ? query.where(eq(table.userId, userId))
        : query);
      return rows.map(
        (row: { userId: string; hostId: number; state: string }) => ({
          ...row,
          state: JSON.parse(row.state),
        }),
      );
    },
    async wipeUser(userId: string): Promise<void> {
      await (await client()).delete(table).where(eq(table.userId, userId));
      await db.persist();
    },
  };
}
