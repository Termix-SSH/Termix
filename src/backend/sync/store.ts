/**
 * Reading and writing a registered entity's rows, whatever table they are in.
 *
 * Every registration names a drizzle table with an id, a syncId (unless it is
 * a singleton) and an owner column, and that is all this relies on. Writes
 * read the row back by its key rather than using RETURNING, which MySQL lacks.
 */

import crypto from "crypto";
import { and, eq, getTableColumns, type SQL } from "drizzle-orm";
import type { SyncRow } from "@termix/plugin-sdk/backend";
import { createCurrentRepositoryContext } from "../database/repositories/factory.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import {
  getEntity,
  type RegisteredSyncEntity,
} from "../plugins/sync-registry.js";
import {
  decryptFields,
  deserializeReferences,
  encryptFields,
  hashWire,
  serializeReferences,
  singletonSyncId,
  toWire,
  toWritable,
  type ResolveId,
  type ResolveSyncId,
} from "./wire.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyTable = any;

function tableOf(entity: RegisteredSyncEntity): AnyTable {
  if (!entity.table) {
    throw new Error(`Sync entity "${entity.type}" has no table`);
  }
  return entity.table as AnyTable;
}

function db() {
  return createCurrentRepositoryContext().drizzle as any;
}

function ownerColumn(entity: RegisteredSyncEntity) {
  const column = tableOf(entity)[entity.userColumn];
  if (!column) {
    throw new Error(
      `Sync entity "${entity.type}" has no ${entity.userColumn} column`,
    );
  }
  return column;
}

export function locate(
  entity: RegisteredSyncEntity,
  userId: string,
  syncId: string,
): SQL {
  const table = tableOf(entity);
  if (entity.singleton) return eq(ownerColumn(entity), userId);
  return and(eq(table.syncId, syncId), eq(ownerColumn(entity), userId))!;
}

export function rowSyncId(entity: RegisteredSyncEntity, row: SyncRow): string {
  return entity.singleton
    ? singletonSyncId(entity.type)
    : (row.syncId as string);
}

let hashKey: Buffer | null = null;

export async function getHashKey(): Promise<Buffer> {
  if (!hashKey) {
    const secret = await SystemCrypto.getInstance().getEncryptionKey();
    hashKey = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        secret,
        Buffer.alloc(0),
        "termix-sync-hash",
        32,
      ),
    );
  }
  return hashKey;
}

/** Test seam. */
export function resetHashKey(): void {
  hashKey = null;
}

export async function listStoredRows(
  entity: RegisteredSyncEntity,
  userId: string,
): Promise<SyncRow[]> {
  const rows = (await db()
    .select()
    .from(tableOf(entity))
    .where(eq(ownerColumn(entity), userId))) as SyncRow[];
  return rows;
}

export async function findStoredRow(
  entity: RegisteredSyncEntity,
  userId: string,
  syncId: string,
): Promise<SyncRow | null> {
  const [row] = (await db()
    .select()
    .from(tableOf(entity))
    .where(locate(entity, userId, syncId))
    .limit(1)) as SyncRow[];
  return row ?? null;
}

/** Gives an old row with no syncId one, so it can take part. */
async function ensureSyncId(
  entity: RegisteredSyncEntity,
  row: SyncRow,
): Promise<string> {
  if (entity.singleton) return singletonSyncId(entity.type);
  if (typeof row.syncId === "string" && row.syncId) return row.syncId;
  const syncId = crypto.randomUUID();
  const table = tableOf(entity);
  await db().update(table).set({ syncId }).where(eq(table.id, row.id));
  row.syncId = syncId;
  return syncId;
}

export interface Resolvers {
  resolveSyncId: ResolveSyncId;
  resolveId: ResolveId;
}

/**
 * Id and syncId lookups for references, scoped to rows the user owns. A core
 * entity can widen that (a credential shared with the user is a valid
 * reference target on the server).
 */
export function createResolvers(
  userId: string,
  onMissing?: (entityType: string, syncId: string) => void,
): Resolvers {
  const allowed = async (
    entityType: string,
    ownerId: unknown,
    id: number,
  ): Promise<boolean> => {
    if (ownerId === userId) return true;
    const canReference = getEntity(entityType)?.canReference;
    return canReference ? canReference(userId, String(ownerId), id) : false;
  };

  return {
    resolveSyncId: async (entityType, id) => {
      const target = getEntity(entityType);
      if (!target?.table || target.singleton) return null;
      const table = tableOf(target);
      const [row] = await db()
        .select({ syncId: table.syncId, owner: ownerColumn(target) })
        .from(table)
        .where(eq(table.id, id))
        .limit(1);
      if (!row || !(await allowed(entityType, row.owner, id))) return null;
      return row.syncId ?? null;
    },
    resolveId: async (entityType, syncId) => {
      const target = getEntity(entityType);
      if (!target?.table || target.singleton) {
        onMissing?.(entityType, syncId);
        return null;
      }
      const table = tableOf(target);
      const rows = await db()
        .select({ id: table.id, owner: ownerColumn(target) })
        .from(table)
        .where(eq(table.syncId, syncId));
      const own = rows.find((row: any) => row.owner === userId);
      if (own) return own.id;
      for (const row of rows) {
        if (await allowed(entityType, row.owner, row.id)) return row.id;
      }
      onMissing?.(entityType, syncId);
      return null;
    },
  };
}

export interface WireRow {
  syncId: string;
  wire: SyncRow;
  hash: string;
}

export interface LoadResult {
  rows: Map<string, WireRow>;
  /** Rows that exist but could not be serialized, so must not read as deleted. */
  failed: Set<string>;
}

/** The user's rows of one entity, on the wire and hashed. */
export async function loadWireRows(
  entity: RegisteredSyncEntity,
  userId: string,
  resolvers: Resolvers,
  options: { filter?: (row: SyncRow) => boolean } = {},
): Promise<LoadResult> {
  const key = await getHashKey();
  const rows = new Map<string, WireRow>();
  const failed = new Set<string>();

  if (entity.load) {
    for (const wire of await entity.load(userId)) {
      const syncId = String(wire.syncId);
      rows.set(syncId, { syncId, wire, hash: hashWire(entity, wire, key) });
    }
    return { rows, failed };
  }

  const dataKey = DataCrypto.getUserDataKey(userId);
  for (const stored of await listStoredRows(entity, userId)) {
    if (entity.shouldSync && entity.shouldSync(stored) === false) continue;
    if (options.filter && !options.filter(stored)) continue;
    const syncId = await ensureSyncId(entity, stored);
    try {
      const plain = decryptFields(entity, stored, dataKey);
      const serialized = await serializeReferences(
        entity,
        plain,
        resolvers.resolveSyncId,
      );
      const wire = toWire(entity, serialized, syncId);
      rows.set(syncId, { syncId, wire, hash: hashWire(entity, wire, key) });
    } catch {
      failed.add(syncId);
    }
  }
  return { rows, failed };
}

/** One row on the wire, or null when it is gone or excluded. */
export async function loadWireRow(
  entity: RegisteredSyncEntity,
  userId: string,
  syncId: string,
  resolvers: Resolvers,
): Promise<WireRow | null> {
  if (entity.load) {
    const all = await loadWireRows(entity, userId, resolvers);
    return all.rows.get(syncId) ?? null;
  }
  const stored = await findStoredRow(entity, userId, syncId);
  if (!stored) return null;
  if (entity.shouldSync && entity.shouldSync(stored) === false) return null;
  const plain = decryptFields(
    entity,
    stored,
    DataCrypto.getUserDataKey(userId),
  );
  const serialized = await serializeReferences(
    entity,
    plain,
    resolvers.resolveSyncId,
  );
  const wire = toWire(entity, serialized, syncId);
  return { syncId, wire, hash: hashWire(entity, wire, await getHashKey()) };
}

function columnsOf(entity: RegisteredSyncEntity): Set<string> {
  return new Set(Object.keys(getTableColumns(tableOf(entity))));
}

export interface WriteResult {
  id: number | null;
  created: boolean;
}

/**
 * Writes an inbound wire row for the user. `extra` is set on top of the
 * inbound fields, for columns this side owns (a shared copy's source).
 */
export async function writeWireRow(
  entity: RegisteredSyncEntity,
  userId: string,
  wire: SyncRow,
  resolvers: Resolvers,
  extra: SyncRow = {},
): Promise<WriteResult> {
  const syncId = String(wire.syncId);
  if (entity.write) {
    await entity.write(userId, wire);
    DatabaseSaveTrigger.triggerSave("sync_write");
    return { id: null, created: false };
  }
  const table = tableOf(entity);
  const current = await findStoredRow(entity, userId, syncId);

  const resolved = await deserializeReferences(
    entity,
    wire,
    resolvers.resolveId,
    current,
  );
  const columns = columnsOf(entity);
  const writable = Object.fromEntries(
    Object.entries({ ...toWritable(entity, resolved), ...extra }).filter(
      ([field]) => columns.has(field),
    ),
  );
  const encrypted = encryptFields(
    entity,
    writable,
    DataCrypto.getUserDataKey(userId),
    current ? String(current.id) : `sync-${syncId}`,
  );
  if (columns.has("updatedAt")) encrypted.updatedAt = new Date().toISOString();

  const where = locate(entity, userId, syncId);
  if (current) {
    await db().update(table).set(encrypted).where(where);
  } else {
    const insert: SyncRow = { ...encrypted, [entity.userColumn]: userId };
    if (!entity.singleton) insert.syncId = syncId;
    await db().insert(table).values(insert);
  }

  const written = await findStoredRow(entity, userId, syncId);
  const id = typeof written?.id === "number" ? written.id : null;
  if (entity.afterWrite) {
    await entity.afterWrite({ id, userId, wire, created: !current });
  }
  DatabaseSaveTrigger.triggerSave("sync_write");
  return { id, created: !current };
}

/** Deletes the user's row, through the entity's own remove when it has one. */
export async function deleteStoredRow(
  entity: RegisteredSyncEntity,
  userId: string,
  syncId: string,
): Promise<boolean> {
  if (entity.erase) {
    await entity.erase(userId, syncId);
    DatabaseSaveTrigger.triggerSave("sync_delete");
    return true;
  }
  const current = await findStoredRow(entity, userId, syncId);
  if (!current) return false;
  if (entity.remove) {
    await entity.remove(current, userId);
  } else {
    await db()
      .delete(tableOf(entity))
      .where(locate(entity, userId, syncId));
  }
  DatabaseSaveTrigger.triggerSave("sync_delete");
  return true;
}

/** Sets fresh syncIds on every row the user owns, so they read as new. */
export async function regenerateSyncIds(
  entity: RegisteredSyncEntity,
  userId: string,
): Promise<void> {
  if (entity.singleton || entity.load || !entity.table) return;
  const table = tableOf(entity);
  for (const row of await listStoredRows(entity, userId)) {
    await db()
      .update(table)
      .set({ syncId: crypto.randomUUID() })
      .where(eq(table.id, row.id));
  }
}
