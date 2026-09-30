import { and, eq, inArray, type SQL } from "drizzle-orm";
import { hostDefaults, hosts, sshFolders } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import type { HostDefaultsLevel } from "../../../types/host-defaults.js";

export type HostDefaultsRecord = typeof hostDefaults.$inferSelect;
export type HostRow = typeof hosts.$inferSelect;

export interface HostDefaultsScope {
  level: HostDefaultsLevel;
  userId?: string | null;
  folderId?: number | null;
}

export interface HostDefaultsEntry {
  namespace: string;
  key: string;
  /** JSON-encoded. */
  value: string;
}

export function scopeKeyFor(scope: HostDefaultsScope): string {
  if (scope.level === "admin") return "admin";
  if (scope.level === "user") return `u:${scope.userId}`;
  return `f:${scope.folderId}`;
}

const CHUNK = 500;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * Host defaults at every level, plus the reads and writes that apply them to
 * hosts in bulk. The resolution itself lives in hosts/defaults.
 */
export class HostDefaultsRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listScope(scope: HostDefaultsScope): Promise<HostDefaultsRecord[]> {
    return this.context.drizzle
      .select()
      .from(hostDefaults)
      .where(eq(hostDefaults.scopeKey, scopeKeyFor(scope)));
  }

  /** The admin rows, and every user and folder row the given users own. */
  async listForUsers(userIds: string[]): Promise<HostDefaultsRecord[]> {
    const admin = await this.context.drizzle
      .select()
      .from(hostDefaults)
      .where(eq(hostDefaults.level, "admin"));
    const own: HostDefaultsRecord[] = [];
    for (const part of chunks([...new Set(userIds)])) {
      own.push(
        ...(await this.context.drizzle
          .select()
          .from(hostDefaults)
          .where(inArray(hostDefaults.userId, part))),
      );
    }
    return [...admin, ...own];
  }

  /** The user's own and folder rows. */
  async listOwnedBy(userId: string): Promise<HostDefaultsRecord[]> {
    return this.context.drizzle
      .select()
      .from(hostDefaults)
      .where(eq(hostDefaults.userId, userId));
  }

  /**
   * Sets and clears keys at one level in one transaction. `set` values are
   * already JSON-encoded.
   */
  async apply(
    scope: HostDefaultsScope,
    set: HostDefaultsEntry[],
    unset: Array<{ namespace: string; key: string }>,
    updatedBy: string | null,
  ): Promise<void> {
    const scopeKey = scopeKeyFor(scope);
    const now = new Date().toISOString();
    const match = (namespace: string, key: string) =>
      and(
        eq(hostDefaults.scopeKey, scopeKey),
        eq(hostDefaults.namespace, namespace),
        eq(hostDefaults.key, key),
      )!;
    const touched = [...set, ...unset];
    if (touched.length === 0) return;

    if (this.context.dialect === "sqlite") {
      // better-sqlite3 runs a transaction synchronously.
      const db = this.context.drizzle;
      db.transaction((tx) => {
        for (const entry of unset) {
          tx.delete(hostDefaults)
            .where(match(entry.namespace, entry.key))
            .run();
        }
        for (const entry of set) {
          const existing = tx
            .select({ id: hostDefaults.id })
            .from(hostDefaults)
            .where(match(entry.namespace, entry.key))
            .limit(1)
            .all();
          if (existing[0]) {
            tx.update(hostDefaults)
              .set({ value: entry.value, updatedBy, updatedAt: now })
              .where(eq(hostDefaults.id, existing[0].id))
              .run();
          } else {
            tx.insert(hostDefaults)
              .values({
                level: scope.level,
                scopeKey,
                userId: scope.level === "admin" ? null : (scope.userId ?? null),
                folderId:
                  scope.level === "folder" ? (scope.folderId ?? null) : null,
                namespace: entry.namespace,
                key: entry.key,
                value: entry.value,
                updatedBy,
                updatedAt: now,
              })
              .run();
          }
        }
      });
    } else {
      await this.context.drizzle.transaction(async (tx) => {
        for (const entry of unset) {
          await tx
            .delete(hostDefaults)
            .where(match(entry.namespace, entry.key));
        }
        for (const entry of set) {
          const existing = await tx
            .select({ id: hostDefaults.id })
            .from(hostDefaults)
            .where(match(entry.namespace, entry.key))
            .limit(1);
          if (existing[0]) {
            await tx
              .update(hostDefaults)
              .set({ value: entry.value, updatedBy, updatedAt: now })
              .where(eq(hostDefaults.id, existing[0].id));
          } else {
            await tx.insert(hostDefaults).values({
              level: scope.level,
              scopeKey,
              userId: scope.level === "admin" ? null : (scope.userId ?? null),
              folderId:
                scope.level === "folder" ? (scope.folderId ?? null) : null,
              namespace: entry.namespace,
              key: entry.key,
              value: entry.value,
              updatedBy,
              updatedAt: now,
            });
          }
        }
      });
    }
    await this.onWrite?.();
  }

  async deleteScope(scope: HostDefaultsScope): Promise<number> {
    const result = await this.context.drizzle
      .delete(hostDefaults)
      .where(eq(hostDefaults.scopeKey, scopeKeyFor(scope)));
    const affected = rowsAffected(result);
    if (affected > 0) await this.onWrite?.();
    return affected;
  }

  /** Folder ids and paths for a set of users. */
  async listFolders(
    userIds: string[],
  ): Promise<Array<{ id: number; userId: string; name: string }>> {
    const rows: Array<{ id: number; userId: string; name: string }> = [];
    for (const part of chunks([...new Set(userIds)])) {
      rows.push(
        ...(await this.context.drizzle
          .select({
            id: sshFolders.id,
            userId: sshFolders.userId,
            name: sshFolders.name,
          })
          .from(sshFolders)
          .where(inArray(sshFolders.userId, part))),
      );
    }
    return rows;
  }

  async findFolder(
    folderId: number,
  ): Promise<{ id: number; userId: string; name: string } | null> {
    const [row] = await this.context.drizzle
      .select({
        id: sshFolders.id,
        userId: sshFolders.userId,
        name: sshFolders.name,
      })
      .from(sshFolders)
      .where(eq(sshFolders.id, folderId))
      .limit(1);
    return row ?? null;
  }

  /** The folder row for a path, created when the folder only exists on hosts. */
  async ensureFolder(userId: string, name: string): Promise<number> {
    const [existing] = await this.context.drizzle
      .select({ id: sshFolders.id })
      .from(sshFolders)
      .where(and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)))
      .limit(1);
    if (existing) return existing.id;
    await this.context.drizzle.insert(sshFolders).values({ userId, name });
    const [created] = await this.context.drizzle
      .select({ id: sshFolders.id })
      .from(sshFolders)
      .where(and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)))
      .limit(1);
    await this.onWrite?.();
    return created.id;
  }

  /** Host rows by id or by owner. Secrets are read as stored, never used. */
  async listHosts(filter: {
    hostIds?: number[];
    userIds?: string[];
    all?: boolean;
  }): Promise<HostRow[]> {
    const db = this.context.drizzle;
    if (filter.all) return db.select().from(hosts);
    const rows: HostRow[] = [];
    const conditions: SQL[] = [];
    for (const part of chunks(filter.hostIds ?? [])) {
      conditions.push(inArray(hosts.id, part));
    }
    for (const part of chunks(filter.userIds ?? [])) {
      conditions.push(inArray(hosts.userId, part));
    }
    for (const condition of conditions) {
      rows.push(...(await db.select().from(hosts).where(condition)));
    }
    const seen = new Set<number>();
    return rows.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }

  /** Every host of the given owners, for walking sub-host chains. */
  async listHostPlacement(userIds: string[]): Promise<
    Array<{
      id: number;
      userId: string;
      folder: string | null;
      parentHostId: number | null;
    }>
  > {
    const rows: Array<{
      id: number;
      userId: string;
      folder: string | null;
      parentHostId: number | null;
    }> = [];
    for (const part of chunks([...new Set(userIds)])) {
      rows.push(
        ...(await this.context.drizzle
          .select({
            id: hosts.id,
            userId: hosts.userId,
            folder: hosts.folder,
            parentHostId: hosts.parentHostId,
          })
          .from(hosts)
          .where(inArray(hosts.userId, part))),
      );
    }
    return rows;
  }

  /**
   * Writes column patches, one statement per host, in one transaction.
   * `updatedAt` is set on each, which is what sync looks for.
   */
  async updateHosts(
    patches: Array<{ id: number; values: Partial<HostRow> }>,
  ): Promise<void> {
    if (patches.length === 0) return;
    const now = new Date().toISOString();
    for (const part of chunks(patches)) {
      if (this.context.dialect === "sqlite") {
        this.context.drizzle.transaction((tx) => {
          for (const patch of part) {
            tx.update(hosts)
              .set({ ...patch.values, updatedAt: now })
              .where(eq(hosts.id, patch.id))
              .run();
          }
        });
      } else {
        await this.context.drizzle.transaction(async (tx) => {
          for (const patch of part) {
            await tx
              .update(hosts)
              .set({ ...patch.values, updatedAt: now })
              .where(eq(hosts.id, patch.id));
          }
        });
      }
    }
    await this.onWrite?.();
  }

  /** Rows that name a folder, credential or host a user no longer has. */
  async deleteWhere(condition: SQL): Promise<number> {
    const result = await this.context.drizzle
      .delete(hostDefaults)
      .where(condition);
    const affected = rowsAffected(result);
    if (affected > 0) await this.onWrite?.();
    return affected;
  }

  async listByKey(
    namespace: string,
    key: string,
  ): Promise<HostDefaultsRecord[]> {
    return this.context.drizzle
      .select()
      .from(hostDefaults)
      .where(
        and(eq(hostDefaults.namespace, namespace), eq(hostDefaults.key, key)),
      );
  }
}
