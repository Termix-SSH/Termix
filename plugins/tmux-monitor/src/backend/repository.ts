import { and, eq } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The table comes from ctx.db.define, which the SDK hands back untyped, and
// the drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type SessionTagRepository = ReturnType<
  typeof createSessionTagRepository
>;

/**
 * A user's tags on a tmux session, per host. Sessions are shared on the host
 * (any user monitoring it sees the same tmux sessions), but tags are per
 * user.
 */
export function createSessionTagRepository(db: PluginDatabase, table: Table) {
  const client = () => db.client<Drizzle>();

  return {
    async listByUserAndHost(
      userId: string,
      hostId: number,
    ): Promise<Map<string, string[]>> {
      const drizzle = await client();
      const rows = await drizzle
        .select()
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.hostId, hostId)));

      const bySession = new Map<string, string[]>();
      for (const row of rows as { sessionName: string; tag: string }[]) {
        const tags = bySession.get(row.sessionName) ?? [];
        tags.push(row.tag);
        bySession.set(row.sessionName, tags);
      }
      return bySession;
    },

    async renameSessionForHost(
      hostId: number,
      sessionName: string,
      newSessionName: string,
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .update(table)
        .set({ sessionName: newSessionName })
        .where(
          and(eq(table.hostId, hostId), eq(table.sessionName, sessionName)),
        );
      await db.persist();
    },

    async deleteSessionForHost(
      hostId: number,
      sessionName: string,
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .delete(table)
        .where(
          and(eq(table.hostId, hostId), eq(table.sessionName, sessionName)),
        );
      await db.persist();
    },

    async replaceForUserHostSession(
      userId: string,
      hostId: number,
      sessionName: string,
      tags: string[],
    ): Promise<void> {
      const drizzle = await client();
      await drizzle
        .delete(table)
        .where(
          and(
            eq(table.userId, userId),
            eq(table.hostId, hostId),
            eq(table.sessionName, sessionName),
          ),
        );
      if (tags.length > 0) {
        await drizzle
          .insert(table)
          .values(tags.map((tag) => ({ userId, hostId, sessionName, tag })));
      }
      await db.persist();
    },
  };
}
