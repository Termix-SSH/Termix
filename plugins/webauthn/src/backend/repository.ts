import { and, eq } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

export interface CredentialRecord {
  id: string;
  userId: string;
  name: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceType: string | null;
  backedUp: boolean;
  transports: string | null;
  userVerification: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// ctx.db.define hands the table back untyped and the drizzle handle is the
// server's own, so both are typed at this module's edge.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type CredentialRepository = ReturnType<
  typeof createCredentialRepository
>;

export function createCredentialRepository(db: PluginDatabase, table: Table) {
  const client = () => db.client<Drizzle>();

  return {
    async listByUserId(userId: string): Promise<CredentialRecord[]> {
      const drizzle = await client();
      return drizzle.select().from(table).where(eq(table.userId, userId));
    },

    async findByCredentialId(
      credentialId: string,
    ): Promise<CredentialRecord | null> {
      const drizzle = await client();
      const rows = await drizzle
        .select()
        .from(table)
        .where(eq(table.credentialId, credentialId))
        .limit(1);
      return (rows[0] as CredentialRecord) ?? null;
    },

    async create(
      input: Omit<CredentialRecord, "lastUsedAt" | "createdAt">,
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .insert(table)
        .values({ ...input, createdAt: new Date().toISOString() });
      await db.persist();
    },

    async updateAuthState(
      id: string,
      state: {
        counter: number;
        backedUp: boolean;
        deviceType: string;
        lastUsedAt: string;
      },
    ): Promise<void> {
      const drizzle = await client();
      await drizzle.update(table).set(state).where(eq(table.id, id));
      await db.persist();
    },

    async deleteForUser(userId: string, id: string): Promise<void> {
      const drizzle = await client();
      await drizzle
        .delete(table)
        .where(and(eq(table.id, id), eq(table.userId, userId)));
      await db.persist();
    },
  };
}
