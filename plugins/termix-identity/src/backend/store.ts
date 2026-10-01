import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
// ctx.db.define hands the tables back untyped and the drizzle handle is the
// server's own, so both are typed at this module's edge.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface IdentityRow {
  id: number;
  userId: string;
  handle: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KeyRow {
  id: number;
  identityId: number;
  userId: string;
  publicKey: string;
  keyType: string;
  algorithm: string;
  label: string | null;
  comment: string | null;
  source: string;
  credentialId: number | null;
  enabled: boolean;
  createdAt: string;
}

export interface CaRow {
  id: number;
  identityId: number;
  userId: string;
  publicKey: string;
  /** Sealed with ctx.secrets.seal. */
  privateKey: string;
  validityDays: number;
  createdAt: string;
  updatedAt: string;
}

export type NewKey = Omit<KeyRow, "id" | "enabled" | "createdAt">;

export interface Tables {
  identities: Table;
  keys: Table;
  ca: Table;
}

function toKey(row: Record<string, unknown>): KeyRow {
  return {
    ...(row as unknown as KeyRow),
    enabled: row.enabled === true || row.enabled === 1 || row.enabled === "1",
  };
}

export type Store = ReturnType<typeof createStore>;

export function createStore(ctx: PluginContext, tables: Tables) {
  const { identities, keys, ca } = tables;
  const client = () => ctx.db.client<Drizzle>();

  async function first<T>(query: Promise<T[]>): Promise<T | null> {
    const rows = await query;
    return rows[0] ?? null;
  }

  const identityForUser = async (userId: string) =>
    first<IdentityRow>(
      (await client())
        .select()
        .from(identities)
        .where(eq(identities.userId, userId))
        .limit(1),
    );

  const identityByHandle = async (handle: string) =>
    first<IdentityRow>(
      (await client())
        .select()
        .from(identities)
        .where(eq(identities.handle, handle))
        .limit(1),
    );

  const keysForIdentity = async (identityId: number): Promise<KeyRow[]> =>
    (
      await (
        await client()
      )
        .select()
        .from(keys)
        .where(eq(keys.identityId, identityId))
        .orderBy(asc(keys.id))
    ).map(toKey);

  const keyForUser = async (userId: string, id: number) => {
    const row = await first<Record<string, unknown>>(
      (await client())
        .select()
        .from(keys)
        .where(and(eq(keys.id, id), eq(keys.userId, userId)))
        .limit(1),
    );
    return row ? toKey(row) : null;
  };

  const caForIdentity = async (identityId: number) =>
    first<CaRow>(
      (await client())
        .select()
        .from(ca)
        .where(eq(ca.identityId, identityId))
        .limit(1),
    );

  return {
    identityForUser,
    identityByHandle,

    async isHandleTaken(handle: string): Promise<boolean> {
      return (await identityByHandle(handle)) !== null;
    },

    async createIdentity(input: {
      userId: string;
      handle: string;
      description: string | null;
    }): Promise<IdentityRow> {
      const now = new Date().toISOString();
      await (
        await client()
      )
        .insert(identities)
        .values({ ...input, createdAt: now, updatedAt: now });
      await ctx.db.persist();
      return (await identityForUser(input.userId)) as IdentityRow;
    },

    async updateIdentity(
      userId: string,
      update: { handle?: string; description?: string | null },
    ): Promise<IdentityRow | null> {
      await (
        await client()
      )
        .update(identities)
        .set({ ...update, updatedAt: new Date().toISOString() })
        .where(eq(identities.userId, userId));
      await ctx.db.persist();
      return identityForUser(userId);
    },

    /** Deletes the identity with its keys and CA. */
    async deleteIdentity(identity: IdentityRow): Promise<void> {
      const db = await client();
      await db.delete(keys).where(eq(keys.identityId, identity.id));
      await db.delete(ca).where(eq(ca.identityId, identity.id));
      await db.delete(identities).where(eq(identities.id, identity.id));
      await ctx.db.persist();
    },

    keysForIdentity,
    keyForUser,

    async enabledKeys(identityId: number): Promise<KeyRow[]> {
      return (await keysForIdentity(identityId)).filter((key) => key.enabled);
    },

    async createKey(input: NewKey): Promise<KeyRow> {
      await (await client()).insert(keys).values({
        ...input,
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      await ctx.db.persist();
      // A public key appears once per identity, so it finds the new row.
      const row = await first<Record<string, unknown>>(
        (await client())
          .select()
          .from(keys)
          .where(
            and(
              eq(keys.identityId, input.identityId),
              eq(keys.publicKey, input.publicKey),
            ),
          )
          .limit(1),
      );
      return toKey(row as Record<string, unknown>);
    },

    async updateKey(
      userId: string,
      id: number,
      update: {
        enabled?: boolean;
        label?: string | null;
        credentialId?: number | null;
      },
    ): Promise<KeyRow | null> {
      if (!(await keyForUser(userId, id))) return null;
      if (Object.keys(update).length > 0) {
        await (
          await client()
        )
          .update(keys)
          .set(update)
          .where(and(eq(keys.id, id), eq(keys.userId, userId)));
        await ctx.db.persist();
      }
      return keyForUser(userId, id);
    },

    async deleteKey(userId: string, id: number): Promise<KeyRow | null> {
      const existing = await keyForUser(userId, id);
      if (!existing) return null;
      await (
        await client()
      )
        .delete(keys)
        .where(and(eq(keys.id, id), eq(keys.userId, userId)));
      await ctx.db.persist();
      return existing;
    },

    async linkedCredentialIds(identityId: number): Promise<number[]> {
      const rows: Array<{ credentialId: number | null }> = await (
        await client()
      )
        .select({ credentialId: keys.credentialId })
        .from(keys)
        .where(
          and(
            eq(keys.identityId, identityId),
            eq(keys.enabled, true),
            isNotNull(keys.credentialId),
          ),
        );
      return [
        ...new Set(
          rows
            .map((row) => Number(row.credentialId))
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      ];
    },

    caForIdentity,

    async createCa(input: {
      identityId: number;
      userId: string;
      publicKey: string;
      privateKey: string;
      validityDays: number;
    }): Promise<void> {
      const now = new Date().toISOString();
      await (
        await client()
      )
        .insert(ca)
        .values({ ...input, createdAt: now, updatedAt: now });
      await ctx.db.persist();
    },

    async replaceCa(
      identityId: number,
      update: { publicKey: string; privateKey: string; validityDays: number },
    ): Promise<void> {
      await (
        await client()
      )
        .update(ca)
        .set({ ...update, updatedAt: new Date().toISOString() })
        .where(eq(ca.identityId, identityId));
      await ctx.db.persist();
    },

    async deleteCa(identityId: number): Promise<boolean> {
      if (!(await caForIdentity(identityId))) return false;
      await (await client()).delete(ca).where(eq(ca.identityId, identityId));
      await ctx.db.persist();
      return true;
    },
  };
}
