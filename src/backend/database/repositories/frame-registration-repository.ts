import { and, eq } from "drizzle-orm";
import { frameRegistrations } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";

export type FrameRegistrationRecord = typeof frameRegistrations.$inferSelect;

export class FrameRegistrationRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async findForClient(
    userId: string,
    client: string,
  ): Promise<FrameRegistrationRecord[]> {
    return this.context.drizzle
      .select()
      .from(frameRegistrations)
      .where(
        and(
          eq(frameRegistrations.userId, userId),
          eq(frameRegistrations.client, client),
        ),
      );
  }

  /** Saves entries by plugin id, as JSON text. */
  async saveMany(
    userId: string,
    client: string,
    entries: Array<{ pluginId: string; data: string }>,
    now = new Date().toISOString(),
  ): Promise<void> {
    if (entries.length === 0) return;
    const existing = new Map(
      (await this.findForClient(userId, client)).map((row) => [
        row.pluginId,
        row,
      ]),
    );
    for (const { pluginId, data } of entries) {
      const row = existing.get(pluginId);
      if (row?.data === data) continue;
      if (row) {
        await this.context.drizzle
          .update(frameRegistrations)
          .set({ data, updatedAt: now })
          .where(eq(frameRegistrations.id, row.id));
      } else {
        try {
          await this.context.drizzle
            .insert(frameRegistrations)
            .values({ userId, client, pluginId, data, updatedAt: now });
        } catch {
          // Another tab saved the same plugin a moment ago.
          await this.context.drizzle
            .update(frameRegistrations)
            .set({ data, updatedAt: now })
            .where(
              and(
                eq(frameRegistrations.userId, userId),
                eq(frameRegistrations.client, client),
                eq(frameRegistrations.pluginId, pluginId),
              ),
            );
        }
      }
    }
    await this.onWrite?.();
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(frameRegistrations)
      .where(eq(frameRegistrations.userId, userId));
    if (rowsAffected(result) > 0) await this.onWrite?.();
    return rowsAffected(result);
  }
}
