import { and, eq } from "drizzle-orm";
import { pluginInstallCounts } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type PluginInstallCountRecord = typeof pluginInstallCounts.$inferSelect;

export interface PluginInstallCountInput {
  pluginId: string;
  count: number;
  source: string;
}

/** Popularity numbers for the store, one row per plugin and registry. */
export class PluginInstallCountRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByRegistry(
    registryId: string,
  ): Promise<PluginInstallCountRecord[]> {
    return this.context.drizzle
      .select()
      .from(pluginInstallCounts)
      .where(eq(pluginInstallCounts.registryId, registryId));
  }

  /** Writes only the rows that changed, so an unchanged sync costs no save. */
  async upsertMany(
    registryId: string,
    entries: PluginInstallCountInput[],
    now = new Date().toISOString(),
  ): Promise<number> {
    const existing = new Map(
      (await this.listByRegistry(registryId)).map((row) => [row.pluginId, row]),
    );
    let written = 0;
    for (const entry of entries) {
      const row = existing.get(entry.pluginId);
      if (row && row.count === entry.count && row.source === entry.source) {
        continue;
      }
      if (row) {
        await this.context.drizzle
          .update(pluginInstallCounts)
          .set({ count: entry.count, source: entry.source, updatedAt: now })
          .where(
            and(
              eq(pluginInstallCounts.pluginId, entry.pluginId),
              eq(pluginInstallCounts.registryId, registryId),
            ),
          );
      } else {
        await this.context.drizzle.insert(pluginInstallCounts).values({
          pluginId: entry.pluginId,
          registryId,
          count: entry.count,
          source: entry.source,
          updatedAt: now,
        });
      }
      written += 1;
    }
    if (written > 0) await this.onWrite?.();
    return written;
  }
}
