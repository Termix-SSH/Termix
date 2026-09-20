import { and, eq } from "drizzle-orm";
import { pluginPermissionGrants } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning } from "./returning.js";

export type PluginPermissionGrantRecord =
  typeof pluginPermissionGrants.$inferSelect;

export interface PluginPermissionGrantCreateInput {
  pluginId: string;
  capability: string;
  grantedBy: string;
}

export class PluginPermissionGrantRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listByPlugin(pluginId: string): Promise<PluginPermissionGrantRecord[]> {
    return this.context.drizzle
      .select()
      .from(pluginPermissionGrants)
      .where(eq(pluginPermissionGrants.pluginId, pluginId));
  }

  async findGrant(
    pluginId: string,
    capability: string,
  ): Promise<PluginPermissionGrantRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(pluginPermissionGrants)
      .where(
        and(
          eq(pluginPermissionGrants.pluginId, pluginId),
          eq(pluginPermissionGrants.capability, capability),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async grant(
    input: PluginPermissionGrantCreateInput,
    now = new Date().toISOString(),
  ): Promise<PluginPermissionGrantRecord> {
    const [created] = await insertReturning(
      this.context,
      pluginPermissionGrants,
      {
        pluginId: input.pluginId,
        capability: input.capability,
        grantedBy: input.grantedBy,
        grantedAt: now,
      },
    );

    await this.afterWrite();
    return created;
  }

  async revoke(pluginId: string, capability: string): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(pluginPermissionGrants)
      .where(
        and(
          eq(pluginPermissionGrants.pluginId, pluginId),
          eq(pluginPermissionGrants.capability, capability),
        ),
      );

    const affected = rowsAffected(result) > 0;
    if (affected) await this.afterWrite();
    return affected;
  }

  async deleteByPlugin(pluginId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(pluginPermissionGrants)
      .where(eq(pluginPermissionGrants.pluginId, pluginId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }
    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
