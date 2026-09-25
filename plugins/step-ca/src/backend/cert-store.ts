import { and, eq } from "drizzle-orm";
import type { PluginContext } from "@termix/plugin-sdk/backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
// ctx.db.define hands the table back untyped and the drizzle handle is the
// server's own, so both are typed at this module's edge.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface IssuedCertificate {
  sshCert: string;
  privateKey: string;
}

export type CertStore = ReturnType<typeof createCertStore>;

export function createCertStore(ctx: PluginContext, table: Table) {
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
    if (!(await find(userId, hostId))) return false;
    await (await client()).delete(table).where(byUserAndHost(userId, hostId));
    await ctx.db.persist();
    return true;
  }

  return {
    async save(
      userId: string,
      hostId: number,
      certificate: IssuedCertificate,
      expiresAt: Date,
      email?: string,
    ): Promise<void> {
      const values = {
        sshCert: await ctx.secrets.seal(certificate.sshCert),
        privateKey: await ctx.secrets.seal(certificate.privateKey),
        email: email ?? null,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
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
    },

    /** The usable certificate, or null. Expired or unreadable rows are deleted. */
    async get(
      userId: string,
      hostId: number,
    ): Promise<IssuedCertificate | null> {
      const row = await find(userId, hostId);
      if (!row) return null;
      const expiresAt = new Date(row.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        await remove(userId, hostId);
        return null;
      }
      const sshCert = await ctx.secrets.unseal(row.sshCert);
      const privateKey = await ctx.secrets.unseal(row.privateKey);
      if (!sshCert || !privateKey) {
        await remove(userId, hostId);
        return null;
      }
      return { sshCert, privateKey };
    },

    remove,
  };
}
