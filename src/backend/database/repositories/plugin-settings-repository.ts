import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { pluginSettings } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";

export type PluginSettingsRecord = typeof pluginSettings.$inferSelect;

/**
 * "secret" holds ctx.secrets values, one row per user and key. The settings
 * service is driven by manifest fields, so it never reads them.
 */
export type PluginSettingsScope = "admin" | "user" | "host" | "secret";

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

  /**
   * Every row across all scope ids for one plugin/scope/key, regardless of
   * owner. For a plugin's own background scan (auto-sync, polling) that needs
   * to find every host with a setting enabled, across every user, before it
   * knows which actor to run as.
   */
  async listByKey(
    pluginId: string,
    scope: PluginSettingsScope,
    key: string,
  ): Promise<PluginSettingsRecord[]> {
    return this.context.drizzle
      .select()
      .from(pluginSettings)
      .where(
        and(
          eq(pluginSettings.pluginId, pluginId),
          eq(pluginSettings.scope, scope),
          eq(pluginSettings.key, key),
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

    if (this.context.dialect === "sqlite") {
      this.context.drizzle.transaction((tx) => {
        const existing = tx
          .select({ id: pluginSettings.id })
          .from(pluginSettings)
          .where(where)
          .orderBy(asc(pluginSettings.id))
          .all();

        if (existing[0]) {
          tx.update(pluginSettings)
            .set({ value, encrypted, updatedAt: now })
            .where(eq(pluginSettings.id, existing[0].id))
            .run();
          if (existing.length > 1) {
            tx.delete(pluginSettings)
              .where(
                inArray(
                  pluginSettings.id,
                  existing.slice(1).map((row) => row.id),
                ),
              )
              .run();
          }
        } else {
          tx.insert(pluginSettings)
            .values({
              pluginId,
              scope,
              scopeId,
              key,
              value,
              encrypted,
              updatedAt: now,
            })
            .run();
        }
      });
    } else {
      await this.context.drizzle.transaction(async (tx) => {
        const exec = (
          tx as unknown as {
            execute?: (query: ReturnType<typeof sql>) => Promise<unknown>;
          }
        ).execute;

        let mysqlLockKey: string | null = null;
        if (scopeId === null && typeof exec === "function") {
          const lockKey = `termix_ps:${pluginId}:${scope}:${key}`;
          if (this.context.dialect === "postgres") {
            await exec.call(
              tx,
              sql`SELECT pg_advisory_xact_lock(1952805485, hashtext(${lockKey}))`,
            );
          } else if (this.context.dialect === "mysql") {
            const boundedKey = lockKey.slice(0, 64);
            await exec.call(tx, sql`SELECT GET_LOCK(${boundedKey}, 10)`);
            mysqlLockKey = boundedKey;
          }
        }

        try {
          const existing = await tx
            .select({ id: pluginSettings.id })
            .from(pluginSettings)
            .where(where)
            .orderBy(asc(pluginSettings.id));

          if (existing[0]) {
            await tx
              .update(pluginSettings)
              .set({ value, encrypted, updatedAt: now })
              .where(eq(pluginSettings.id, existing[0].id));
            if (existing.length > 1) {
              await tx.delete(pluginSettings).where(
                inArray(
                  pluginSettings.id,
                  existing.slice(1).map((row) => row.id),
                ),
              );
            }
          } else {
            await tx.insert(pluginSettings).values({
              pluginId,
              scope,
              scopeId,
              key,
              value,
              encrypted,
              updatedAt: now,
            });
          }
        } finally {
          if (mysqlLockKey && typeof exec === "function") {
            await exec
              .call(tx, sql`SELECT RELEASE_LOCK(${mysqlLockKey})`)
              .catch(() => undefined);
          }
        }
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

  /** How many stored values the plugin has in each scope. */
  async countByScope(
    pluginId: string,
  ): Promise<Record<PluginSettingsScope, number>> {
    const rows = await this.context.drizzle
      .select({ scope: pluginSettings.scope })
      .from(pluginSettings)
      .where(eq(pluginSettings.pluginId, pluginId));

    const counts: Record<PluginSettingsScope, number> = {
      admin: 0,
      user: 0,
      host: 0,
      secret: 0,
    };
    for (const row of rows) {
      const scope = row.scope as PluginSettingsScope;
      if (scope in counts) counts[scope] += 1;
    }
    return counts;
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
