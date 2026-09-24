import { eq, or } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

export type SecretSourceKind = "onepassword-connect";

export interface SecretSourceRecord {
  id: string;
  userId: string;
  name: string;
  kind: SecretSourceKind;
  baseUrl: string;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SecretSourceCreateInput {
  id: string;
  userId: string;
  name: string;
  kind: SecretSourceKind;
  baseUrl: string;
  shared: boolean;
}

export interface SecretSourceUpdateInput {
  name?: string;
  baseUrl?: string;
  shared?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// The table comes from ctx.db.define, which the SDK hands back untyped, and
// the drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type SecretSourceRepository = ReturnType<
  typeof createSecretSourceRepository
>;

/**
 * Per-user secret source storage. The token is never in this table - it
 * lives in ctx.secrets under "source:<id>". A row with an id the caller
 * chose is written without RETURNING so it runs the same on all three
 * engines.
 */
export function createSecretSourceRepository(db: PluginDatabase, table: Table) {
  const client = () => db.client<Drizzle>();

  async function findById(id: string): Promise<SecretSourceRecord | null> {
    const drizzle = await client();
    const rows = await drizzle
      .select()
      .from(table)
      .where(eq(table.id, id))
      .limit(1);
    return (rows[0] as SecretSourceRecord) ?? null;
  }

  return {
    findById,

    async listVisibleToUser(userId: string): Promise<SecretSourceRecord[]> {
      const drizzle = await client();
      return drizzle
        .select()
        .from(table)
        .where(or(eq(table.userId, userId), eq(table.shared, true)));
    },

    async create(
      input: SecretSourceCreateInput,
      now = new Date().toISOString(),
    ): Promise<SecretSourceRecord> {
      const drizzle = await client();
      await drizzle.insert(table).values({
        id: input.id,
        userId: input.userId,
        name: input.name,
        kind: input.kind,
        baseUrl: input.baseUrl,
        shared: input.shared,
        createdAt: now,
        updatedAt: now,
      });
      await db.persist();
      return (await findById(input.id)) as SecretSourceRecord;
    },

    async update(
      row: SecretSourceRecord,
      input: SecretSourceUpdateInput,
      now = new Date().toISOString(),
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .update(table)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
          ...(input.shared !== undefined ? { shared: input.shared } : {}),
          updatedAt: now,
        })
        .where(eq(table.id, row.id));
      await db.persist();
    },

    async deleteById(id: string): Promise<void> {
      const drizzle = await client();
      await drizzle.delete(table).where(eq(table.id, id));
      await db.persist();
    },
  };
}
