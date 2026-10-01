import { and, eq } from "drizzle-orm";
import { pluginMigrations } from "../db/schema.js";
import { insertReturning } from "./returning.js";
import { rowsAffected } from "./mutation-result.js";
import type { DatabaseContext } from "./database-context.js";

export type PluginMigrationRecord = typeof pluginMigrations.$inferSelect;

/**
 * Which of a plugin's migrations have run.
 *
 * The checksum is the reason this is a table rather than a file marker: it
 * makes an applied migration immutable, so an edited one is caught instead of
 * leaving two installs with quietly different schemas.
 */
export class PluginMigrationRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByPlugin(pluginId: string): Promise<PluginMigrationRecord[]> {
    return this.context.drizzle
      .select()
      .from(pluginMigrations)
      .where(eq(pluginMigrations.pluginId, pluginId));
  }

  async record(
    pluginId: string,
    migrationId: string,
    checksum: string,
    now = new Date().toISOString(),
  ): Promise<void> {
    await insertReturning(this.context, pluginMigrations, {
      pluginId,
      migrationId,
      checksum,
      appliedAt: now,
    });

    await this.afterWrite();
  }

  async deleteByPlugin(pluginId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(pluginMigrations)
      .where(eq(pluginMigrations.pluginId, pluginId));

    const affected = rowsAffected(result);
    if (affected > 0) await this.afterWrite();
    return affected;
  }

  async has(pluginId: string, migrationId: string): Promise<boolean> {
    const rows = await this.context.drizzle
      .select()
      .from(pluginMigrations)
      .where(
        and(
          eq(pluginMigrations.pluginId, pluginId),
          eq(pluginMigrations.migrationId, migrationId),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
