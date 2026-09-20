import { and, eq } from "drizzle-orm";
import { pluginInstallCounts } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

export type PluginInstallCountRecord = typeof pluginInstallCounts.$inferSelect;

export interface PluginInstallCountUpsertInput {
  pluginId: string;
  registryId: string;
  count: number;
  source?: string;
}

export class PluginInstallCountRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByPlugin(pluginId: string): Promise<PluginInstallCountRecord[]> {
    return this.context.drizzle
      .select()
      .from(pluginInstallCounts)
      .where(eq(pluginInstallCounts.pluginId, pluginId));
  }

  async findByPluginAndRegistry(
    pluginId: string,
    registryId: string,
  ): Promise<PluginInstallCountRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(pluginInstallCounts)
      .where(
        and(
          eq(pluginInstallCounts.pluginId, pluginId),
          eq(pluginInstallCounts.registryId, registryId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async upsert(
    input: PluginInstallCountUpsertInput,
    now = new Date().toISOString(),
  ): Promise<PluginInstallCountRecord> {
    const existing = await this.findByPluginAndRegistry(
      input.pluginId,
      input.registryId,
    );

    if (existing) {
      const [updated] = await updateReturning(
        this.context,
        pluginInstallCounts,
        {
          count: input.count,
          source: input.source ?? existing.source,
          updatedAt: now,
        },
        eq(pluginInstallCounts.id, existing.id),
      );

      await this.afterWrite();
      return updated;
    }

    const [created] = await insertReturning(this.context, pluginInstallCounts, {
      pluginId: input.pluginId,
      registryId: input.registryId,
      count: input.count,
      source: input.source ?? "aggregate-telemetry",
      updatedAt: now,
    });

    await this.afterWrite();
    return created;
  }

  async deleteByPlugin(pluginId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(pluginInstallCounts)
      .where(eq(pluginInstallCounts.pluginId, pluginId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }
    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
