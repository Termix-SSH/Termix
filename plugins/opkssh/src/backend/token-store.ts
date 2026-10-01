import { and, eq } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
// ctx.db.define hands the table back untyped and the drizzle handle is the
// server's own, so both are typed at this module's edge.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** How long a certificate is cached after sign-in. */
export const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface StoredCertificate {
  sshCert: string;
  privateKey: string;
}

export interface CertificateIdentity {
  email?: string;
  sub?: string;
  issuer?: string;
  audience?: string;
}

export interface TokenStatus {
  exists: boolean;
  expiresAt?: string;
  email?: string | null;
}

export type TokenStore = ReturnType<typeof createTokenStore>;

export function createTokenStore(ctx: PluginContext, table: Table) {
  const client = () => ctx.db.client<Drizzle>();
  const byUserAndHost = (userId: string, hostId: number) =>
    and(eq(table.userId, userId), eq(table.hostId, hostId));

  async function find(userId: string, hostId: number) {
    const rows = await (
      await client()
    )
      .select()
      .from(table)
      .where(byUserAndHost(userId, hostId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function remove(userId: string, hostId: number): Promise<boolean> {
    const existing = await find(userId, hostId);
    if (!existing) return false;
    await (await client()).delete(table).where(byUserAndHost(userId, hostId));
    await ctx.db.persist();
    return true;
  }

  function expired(row: { expiresAt: string }): boolean {
    const expiresAt = new Date(row.expiresAt).getTime();
    return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  }

  return {
    async save(
      userId: string,
      hostId: number,
      certificate: StoredCertificate,
      identity: CertificateIdentity,
    ): Promise<string> {
      const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
      const values = {
        sshCert: await ctx.secrets.seal(certificate.sshCert),
        privateKey: await ctx.secrets.seal(certificate.privateKey),
        email: identity.email ?? null,
        sub: identity.sub ?? null,
        issuer: identity.issuer ?? null,
        audience: identity.audience ?? null,
        createdAt: new Date().toISOString(),
        expiresAt,
        lastUsed: null,
      };
      if (await find(userId, hostId)) {
        await (
          await client()
        )
          .update(table)
          .set(values)
          .where(byUserAndHost(userId, hostId));
      } else {
        await (
          await client()
        )
          .insert(table)
          .values({ userId, hostId, ...values });
      }
      await ctx.db.persist();
      return expiresAt;
    },

    /**
     * The usable certificate, or null. An expired row, or one that does not
     * unseal (written by 2.8), is deleted.
     */
    async get(
      userId: string,
      hostId: number,
    ): Promise<StoredCertificate | null> {
      const row = await find(userId, hostId);
      if (!row) return null;
      if (expired(row)) {
        await remove(userId, hostId);
        return null;
      }
      const sshCert = await ctx.secrets.unseal(row.sshCert);
      const privateKey = await ctx.secrets.unseal(row.privateKey);
      if (!sshCert || !privateKey) {
        await remove(userId, hostId);
        return null;
      }
      await (
        await client()
      )
        .update(table)
        .set({ lastUsed: new Date().toISOString() })
        .where(byUserAndHost(userId, hostId));
      await ctx.db.persist({ lazy: true });
      return { sshCert, privateKey };
    },

    async status(userId: string, hostId: number): Promise<TokenStatus> {
      const row = await find(userId, hostId);
      if (!row) return { exists: false };
      if (expired(row)) {
        await remove(userId, hostId);
        return { exists: false };
      }
      return { exists: true, expiresAt: row.expiresAt, email: row.email };
    },

    remove,
  };
}
