import { randomUUID } from "node:crypto";
import { desc, eq, or } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { VaultProfileConfig } from "./vault-client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// ctx.db.define hands the table back untyped and the drizzle handle is the
// server's own, so both are typed at this module's edge.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const SYNC_ENTITY = "vaultProfiles";

export interface ProfileRow {
  id: number;
  userId: string;
  name: string;
  description: string | null;
  folder: string | null;
  tags: string | null;
  vaultAddr: string;
  vaultNamespace: string | null;
  oidcMount: string | null;
  oidcRole: string | null;
  sshMount: string | null;
  sshRole: string;
  validPrincipals: string | null;
  keyType: string | null;
  shared: boolean | number;
  syncId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProfileInput = Partial<
  Omit<ProfileRow, "id" | "userId" | "syncId" | "createdAt" | "updatedAt">
>;

export function toConfig(row: ProfileRow): VaultProfileConfig {
  return {
    id: row.id,
    vaultAddr: row.vaultAddr,
    vaultNamespace: row.vaultNamespace ?? null,
    oidcMount: row.oidcMount ?? null,
    oidcRole: row.oidcRole ?? null,
    sshMount: row.sshMount ?? null,
    sshRole: row.sshRole,
    validPrincipals: row.validPrincipals ?? null,
    keyType: row.keyType ?? null,
  };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;

export function createProfileStore(
  ctx: PluginContext,
  table: Table,
  tokensTable: Table,
) {
  const client = () => ctx.db.client<Drizzle>();

  async function findById(id: number): Promise<ProfileRow | null> {
    const rows = await (
      await client()
    )
      .select()
      .from(table)
      .where(eq(table.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async function findBySyncId(syncId: string): Promise<ProfileRow | null> {
    const rows = await (
      await client()
    )
      .select()
      .from(table)
      .where(eq(table.syncId, syncId))
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    findById,
    findBySyncId,

    /** The user's own profiles plus every shared one. */
    async listVisible(userId: string): Promise<ProfileRow[]> {
      return (await client())
        .select()
        .from(table)
        .where(or(eq(table.userId, userId), eq(table.shared, true)))
        .orderBy(desc(table.updatedAt));
    },

    async create(
      userId: string,
      input: ProfileInput & {
        name: string;
        vaultAddr: string;
        sshRole: string;
      },
    ): Promise<ProfileRow> {
      const syncId = randomUUID();
      const now = new Date().toISOString();
      await (await client()).insert(table).values({
        ...input,
        userId,
        shared: input.shared ? true : false,
        syncId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.persist();
      return (await findBySyncId(syncId)) as ProfileRow;
    },

    async update(id: number, input: ProfileInput): Promise<ProfileRow | null> {
      await (
        await client()
      )
        .update(table)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(eq(table.id, id));
      await ctx.db.persist();
      return findById(id);
    },

    /** Deletes the profile, its cached certificates and records a tombstone. */
    async remove(row: ProfileRow): Promise<void> {
      const db = await client();
      await db.delete(tokensTable).where(eq(tokensTable.profileId, row.id));
      await db.delete(table).where(eq(table.id, row.id));
      await ctx.db.persist();
      await ctx.sync.recordTombstone(row.userId, SYNC_ENTITY, row.syncId);
    },
  };
}
