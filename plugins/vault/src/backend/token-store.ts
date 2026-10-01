import { and, eq } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { parseCertValidBefore } from "./vault-client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// Sign again once a certificate is this close to expiring.
const EXPIRY_SKEW_MS = 60 * 1000;
// When the certificate's expiry cannot be read.
const FALLBACK_TTL_MS = 5 * 60 * 1000;

export interface CachedCertificate {
  privateKey: string;
  sshCert: string;
}

export type TokenStore = ReturnType<typeof createTokenStore>;

export function createTokenStore(ctx: PluginContext, table: Table) {
  const client = () => ctx.db.client<Drizzle>();
  const match = (userId: string, profileId: number) =>
    and(eq(table.userId, userId), eq(table.profileId, profileId));

  async function find(userId: string, profileId: number) {
    const rows = await (
      await client()
    )
      .select()
      .from(table)
      .where(match(userId, profileId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function remove(userId: string, profileId: number): Promise<void> {
    if (!(await find(userId, profileId))) return;
    await (await client()).delete(table).where(match(userId, profileId));
    await ctx.db.persist();
  }

  return {
    /** Stores a signed certificate and returns when it expires. */
    async save(
      userId: string,
      profileId: number,
      privateKey: string,
      sshCert: string,
    ): Promise<string> {
      const validBefore = parseCertValidBefore(sshCert);
      const expiresAt = new Date(
        validBefore > 0 ? validBefore * 1000 : Date.now() + FALLBACK_TTL_MS,
      ).toISOString();
      const values = {
        sshCert: await ctx.secrets.seal(sshCert),
        privateKey: await ctx.secrets.seal(privateKey),
        createdAt: new Date().toISOString(),
        expiresAt,
        lastUsed: null,
      };
      if (await find(userId, profileId)) {
        await (
          await client()
        )
          .update(table)
          .set(values)
          .where(match(userId, profileId));
      } else {
        await (
          await client()
        )
          .insert(table)
          .values({ userId, profileId, ...values });
      }
      await ctx.db.persist();
      return expiresAt;
    },

    /** A usable certificate, or null. Expired or unreadable rows are deleted. */
    async get(
      userId: string,
      profileId: number,
    ): Promise<CachedCertificate | null> {
      const row = await find(userId, profileId);
      if (!row) return null;
      const expiresAt = new Date(row.expiresAt).getTime();
      if (
        !Number.isFinite(expiresAt) ||
        expiresAt - EXPIRY_SKEW_MS < Date.now()
      ) {
        await remove(userId, profileId);
        return null;
      }
      const sshCert = await ctx.secrets.unseal(row.sshCert);
      const privateKey = await ctx.secrets.unseal(row.privateKey);
      if (!sshCert || !privateKey) {
        await remove(userId, profileId);
        return null;
      }
      await (
        await client()
      )
        .update(table)
        .set({ lastUsed: new Date().toISOString() })
        .where(match(userId, profileId));
      await ctx.db.persist({ lazy: true });
      return { sshCert, privateKey };
    },

    remove,
  };
}
