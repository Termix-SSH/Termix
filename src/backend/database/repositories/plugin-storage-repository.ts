import { and, eq } from "drizzle-orm";
import { pluginStorage } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

export type PluginStorageRecord = typeof pluginStorage.$inferSelect;

export class PluginStorageRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async get(pluginId: string, key: string): Promise<string | null> {
    const rows = await this.context.drizzle
      .select()
      .from(pluginStorage)
      .where(
        and(eq(pluginStorage.pluginId, pluginId), eq(pluginStorage.key, key)),
      )
      .limit(1);

    return rows[0]?.value ?? null;
  }

  async listKeys(pluginId: string): Promise<string[]> {
    const rows = await this.context.drizzle
      .select()
      .from(pluginStorage)
      .where(eq(pluginStorage.pluginId, pluginId));

    return rows.map((row) => row.key);
  }

  /** How many keys this plugin holds, for the per-plugin key cap. */
  async countKeys(pluginId: string): Promise<number> {
    const rows = await this.context.drizzle
      .select()
      .from(pluginStorage)
      .where(eq(pluginStorage.pluginId, pluginId));

    return rows.length;
  }

  async set(
    pluginId: string,
    key: string,
    value: string,
    now = new Date().toISOString(),
  ): Promise<void> {
    const existing = await this.context.drizzle
      .select()
      .from(pluginStorage)
      .where(
        and(eq(pluginStorage.pluginId, pluginId), eq(pluginStorage.key, key)),
      )
      .limit(1);

    if (existing[0]) {
      await updateReturning(
        this.context,
        pluginStorage,
        { value, updatedAt: now },
        and(eq(pluginStorage.pluginId, pluginId), eq(pluginStorage.key, key))!,
      );
    } else {
      await insertReturning(this.context, pluginStorage, {
        pluginId,
        key,
        value,
        updatedAt: now,
      });
    }

    await this.afterWrite();
  }

  async delete(pluginId: string, key: string): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(pluginStorage)
      .where(
        and(eq(pluginStorage.pluginId, pluginId), eq(pluginStorage.key, key)),
      );

    const affected = rowsAffected(result) > 0;
    if (affected) await this.afterWrite();
    return affected;
  }

  async deleteByPlugin(pluginId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(pluginStorage)
      .where(eq(pluginStorage.pluginId, pluginId));

    if (rowsAffected(result) > 0) await this.afterWrite();
    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
