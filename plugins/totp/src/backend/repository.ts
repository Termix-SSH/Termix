import { eq } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

export interface EnrollmentRecord {
  userId: string;
  secret: string | null;
  pendingSecret: string | null;
  backupCodes: string | null;
  createdAt: string;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// ctx.db.define hands the table back untyped and the drizzle handle is the
// server's own, so both are typed at this module's edge.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type EnrollmentRepository = ReturnType<
  typeof createEnrollmentRepository
>;

/** Sealed values only: nothing here ever sees a plaintext secret. */
export function createEnrollmentRepository(db: PluginDatabase, table: Table) {
  const client = () => db.client<Drizzle>();

  async function find(userId: string): Promise<EnrollmentRecord | null> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(table)
      .where(eq(table.userId, userId))
      .limit(1);
    return (rows[0] as EnrollmentRecord) ?? null;
  }

  async function save(
    userId: string,
    values: Partial<
      Pick<EnrollmentRecord, "secret" | "pendingSecret" | "backupCodes">
    >,
  ): Promise<void> {
    const drizzle = await client();
    const now = new Date().toISOString();
    if (await find(userId)) {
      await drizzle
        .update(table)
        .set({ ...values, updatedAt: now })
        .where(eq(table.userId, userId));
    } else {
      await drizzle
        .insert(table)
        .values({ userId, ...values, createdAt: now, updatedAt: now });
    }
    await db.persist();
  }

  return {
    find,
    save,

    async remove(userId: string): Promise<void> {
      const drizzle = await client();
      await drizzle.delete(table).where(eq(table.userId, userId));
      await db.persist();
    },
  };
}
