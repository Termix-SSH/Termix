import { rbacKnownPermissions, rbacAppliedDefaults } from "../db/schema.js";
import { insertReturning } from "./returning.js";
import type { DatabaseContext } from "./database-context.js";

export type RbacKnownPermissionRecord =
  typeof rbacKnownPermissions.$inferSelect;
export type RbacAppliedDefaultRecord = typeof rbacAppliedDefaults.$inferSelect;

export interface KnownPermissionInput {
  permission: string;
  pluginId?: string | null;
}

export interface AppliedDefaultInput {
  roleName: string;
  permission: string;
}

/**
 * The two records that make plugin permissions outlive their plugin.
 *
 * `rbac_known_permissions` is why a role holding `ai.use` still saves while the
 * ai plugin is disabled. `rbac_applied_defaults` is why a default an admin
 * revoked is not handed back on the next boot. Neither has a foreign key to
 * `plugins`, because both have to survive the plugin going away.
 */
export class RbacPermissionRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listKnown(): Promise<RbacKnownPermissionRecord[]> {
    return this.context.drizzle.select().from(rbacKnownPermissions);
  }

  /** Inserts the ones that are new. Re-recording an existing one is a no-op. */
  async recordKnown(
    entries: KnownPermissionInput[],
    now = new Date().toISOString(),
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const existing = new Set(
      (await this.listKnown()).map((row) => row.permission),
    );

    let written = 0;
    for (const entry of entries) {
      if (existing.has(entry.permission)) continue;
      existing.add(entry.permission);

      // Another boot can win the race on a shared database, and losing it just
      // means the row is already there.
      try {
        await insertReturning(this.context, rbacKnownPermissions, {
          permission: entry.permission,
          pluginId: entry.pluginId ?? null,
          firstSeenAt: now,
        });
        written += 1;
      } catch {
        continue;
      }
    }

    if (written > 0) await this.afterWrite();
    return written;
  }

  async listAppliedDefaults(): Promise<RbacAppliedDefaultRecord[]> {
    return this.context.drizzle.select().from(rbacAppliedDefaults);
  }

  async recordAppliedDefaults(
    entries: AppliedDefaultInput[],
    now = new Date().toISOString(),
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const existing = new Set(
      (await this.listAppliedDefaults()).map(
        (row) => `${row.roleName}:${row.permission}`,
      ),
    );

    let written = 0;
    for (const entry of entries) {
      const key = `${entry.roleName}:${entry.permission}`;
      if (existing.has(key)) continue;
      existing.add(key);

      try {
        await insertReturning(this.context, rbacAppliedDefaults, {
          roleName: entry.roleName,
          permission: entry.permission,
          appliedAt: now,
        });
        written += 1;
      } catch {
        continue;
      }
    }

    if (written > 0) await this.afterWrite();
    return written;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
