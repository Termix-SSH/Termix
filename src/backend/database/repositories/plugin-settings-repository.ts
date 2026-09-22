import { and, eq, inArray, isNull } from "drizzle-orm";
import { pluginSettings } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning, updateReturning } from "./returning.js";

export type PluginSettingsRecord = typeof pluginSettings.$inferSelect;

export type PluginSettingsScope = "admin" | "user" | "host";

/**
 * Values behind ctx.settings and the /plugins/:id/settings routes.
 *
 * scope_id is null for admin scope, so every lookup has to use IS NULL rather
 * than = NULL: SQL equality against null never matches, which would make an
 * admin setting look unset no matter how often it was written.
 */
export class PluginSettingsRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  private scopeMatch(
    pluginId: string,
    scope: PluginSettingsScope,
    scopeId: string | null,
  ) {
    return and(
      eq(pluginSettings.pluginId, pluginId),
      eq(pluginSettings.scope, scope),
      scopeId === null
        ? isNull(pluginSettings.scopeId)
        : eq(pluginSettings.scopeId, scopeId),
    );
  }

  async get(
    pluginId: string,
    scope: PluginSettingsScope,
    scopeId: string | null,
    key: string,
  ): Promise<PluginSettingsRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(pluginSettings)
      .where(
        and(
          this.scopeMatch(pluginId, scope, scopeId),
          eq(pluginSettings.key, key),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async getAll(
    pluginId: string,
    scope: PluginSettingsScope,
    scopeId: string | null,
  ): Promise<PluginSettingsRecord[]> {
    return this.context.drizzle
      .select()
      .from(pluginSettings)
      .where(this.scopeMatch(pluginId, scope, scopeId));
  }

  /**
   * Every row for a set of scope ids, in one query.
   *
   * The host list would otherwise run one query per host, which is the shape
   * that made other list endpoints slow at a few hundred hosts.
   */
  async getAllForScopeIds(
    scope: PluginSettingsScope,
    scopeIds: string[],
  ): Promise<PluginSettingsRecord[]> {
    if (scopeIds.length === 0) return [];

    return this.context.drizzle
      .select()
      .from(pluginSettings)
      .where(
        and(
          eq(pluginSettings.scope, scope),
          inArray(pluginSettings.scopeId, scopeIds),
        ),
      );
  }

  async set(
    pluginId: string,
    scope: PluginSettingsScope,
    scopeId: string | null,
    key: string,
    value: string | null,
    encrypted = false,
    now = new Date().toISOString(),
  ): Promise<void> {
    const where = and(
      this.scopeMatch(pluginId, scope, scopeId),
      eq(pluginSettings.key, key),
    )!;

    const existing = await this.context.drizzle
      .select()
      .from(pluginSettings)
      .where(where)
      .limit(1);

    if (existing[0]) {
      await updateReturning(
        this.context,
        pluginSettings,
        { value, encrypted, updatedAt: now },
        where,
      );
    } else {
      await insertReturning(this.context, pluginSettings, {
        pluginId,
        scope,
        scopeId,
        key,
        value,
        encrypted,
        updatedAt: now,
      });
    }

    await this.afterWrite();
  }

  async delete(
    pluginId: string,
    scope: PluginSettingsScope,
    scopeId: string | null,
    key: string,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(pluginSettings)
      .where(
        and(
          this.scopeMatch(pluginId, scope, scopeId),
          eq(pluginSettings.key, key),
        ),
      );

    const affected = rowsAffected(result) > 0;
    if (affected) await this.afterWrite();
    return affected;
  }

  async deleteByPlugin(pluginId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(pluginSettings)
      .where(eq(pluginSettings.pluginId, pluginId));

    const affected = rowsAffected(result);
    if (affected > 0) await this.afterWrite();
    return affected;
  }

  /**
   * Removes every plugin's rows for one user or host.
   *
   * scope_id carries no foreign key, so the user and host delete paths call
   * this instead of relying on the engine to cascade.
   */
  async deleteByScope(
    scope: PluginSettingsScope,
    scopeId: string,
  ): Promise<number> {
    const result = await this.context.drizzle
      .delete(pluginSettings)
      .where(
        and(
          eq(pluginSettings.scope, scope),
          eq(pluginSettings.scopeId, scopeId),
        ),
      );

    const affected = rowsAffected(result);
    if (affected > 0) await this.afterWrite();
    return affected;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
