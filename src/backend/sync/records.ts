/**
 * The per-record sync bookkeeping in sync_records. See the table's comment in
 * schema.ts for what the columns mean on a server and on a desktop.
 */

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { syncConflicts, syncRecords } from "../database/db/schema.js";
import { createCurrentRepositoryContext } from "../database/repositories/factory.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";

export type SyncRecord = typeof syncRecords.$inferSelect;
export type SyncConflict = typeof syncConflicts.$inferSelect;

export function recordKey(entityType: string, syncId: string): string {
  return `${entityType}\u0000${syncId}`;
}

function db() {
  return createCurrentRepositoryContext().drizzle;
}

export async function listRecords(
  userId: string,
  entityType?: string,
): Promise<Map<string, SyncRecord>> {
  const rows = await db()
    .select()
    .from(syncRecords)
    .where(
      entityType
        ? and(
            eq(syncRecords.userId, userId),
            eq(syncRecords.entityType, entityType),
          )
        : eq(syncRecords.userId, userId),
    );
  return new Map(
    rows.map((row) => [recordKey(row.entityType, row.syncId), row]),
  );
}

export async function getRecord(
  userId: string,
  entityType: string,
  syncId: string,
): Promise<SyncRecord | null> {
  const [row] = await db()
    .select()
    .from(syncRecords)
    .where(
      and(
        eq(syncRecords.userId, userId),
        eq(syncRecords.entityType, entityType),
        eq(syncRecords.syncId, syncId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface RecordValues {
  revision: number;
  seq?: number;
  hash: string | null;
  deleted: boolean;
  error?: string | null;
  errorHash?: string | null;
}

export async function putRecord(
  userId: string,
  entityType: string,
  syncId: string,
  values: RecordValues,
): Promise<void> {
  const set = {
    revision: values.revision,
    hash: values.hash,
    deleted: values.deleted,
    error: values.error ?? null,
    errorHash: values.errorHash ?? null,
    updatedAt: new Date().toISOString(),
    ...(values.seq !== undefined ? { seq: values.seq } : {}),
  };
  const existing = await getRecord(userId, entityType, syncId);
  if (existing) {
    await db()
      .update(syncRecords)
      .set(set)
      .where(eq(syncRecords.id, existing.id));
  } else {
    await db()
      .insert(syncRecords)
      .values({ userId, entityType, syncId, seq: 0, ...set });
  }
  DatabaseSaveTrigger.triggerSave("sync_record");
}

export async function setRecordError(
  userId: string,
  entityType: string,
  syncId: string,
  error: string,
  errorHash: string,
): Promise<void> {
  const existing = await getRecord(userId, entityType, syncId);
  if (existing) {
    await db()
      .update(syncRecords)
      .set({ error, errorHash })
      .where(eq(syncRecords.id, existing.id));
  } else {
    await db().insert(syncRecords).values({
      userId,
      entityType,
      syncId,
      revision: 0,
      seq: 0,
      hash: null,
      deleted: false,
      error,
      errorHash,
    });
  }
  DatabaseSaveTrigger.triggerSave("sync_record");
}

export async function clearRecordErrors(userId: string): Promise<void> {
  await db()
    .update(syncRecords)
    .set({ error: null, errorHash: null })
    .where(eq(syncRecords.userId, userId));
}

export async function listRecordErrors(userId: string): Promise<SyncRecord[]> {
  const rows = await db()
    .select()
    .from(syncRecords)
    .where(eq(syncRecords.userId, userId));
  return rows.filter((row) => !!row.error);
}

export async function listChanges(
  userId: string,
  cursor: number,
  limit: number,
  types?: string[],
): Promise<SyncRecord[]> {
  const conditions = [
    eq(syncRecords.userId, userId),
    gt(syncRecords.seq, cursor),
  ];
  if (types && types.length > 0) {
    conditions.push(inArray(syncRecords.entityType, types));
  }
  return db()
    .select()
    .from(syncRecords)
    .where(and(...conditions))
    .orderBy(asc(syncRecords.seq))
    .limit(limit);
}

export async function deleteRecordsForUser(userId: string): Promise<void> {
  await db().delete(syncRecords).where(eq(syncRecords.userId, userId));
  await db().delete(syncConflicts).where(eq(syncConflicts.userId, userId));
  DatabaseSaveTrigger.triggerSave("sync_record");
}

let nextSeq: number | null = null;

/**
 * The next position in the change feed. One counter for every user, so a
 * seq is never reused; a single process owns it, seeded from the table.
 */
export async function allocateSeq(): Promise<number> {
  if (nextSeq === null) {
    const [row] = await db()
      .select({ max: sql<number>`max(${syncRecords.seq})` })
      .from(syncRecords);
    const max = Number(row?.max ?? 0);
    nextSeq = (Number.isFinite(max) ? max : 0) + 1;
  }
  return nextSeq++;
}

/** Test seam. */
export function resetSeqAllocator(): void {
  nextSeq = null;
}

export async function saveConflict(
  userId: string,
  entityType: string,
  syncId: string,
  localRow: Record<string, unknown>,
  serverRevision: number,
): Promise<void> {
  await db()
    .delete(syncConflicts)
    .where(
      and(
        eq(syncConflicts.userId, userId),
        eq(syncConflicts.entityType, entityType),
        eq(syncConflicts.syncId, syncId),
      ),
    );
  await db()
    .insert(syncConflicts)
    .values({
      userId,
      entityType,
      syncId,
      localRow: JSON.stringify(localRow),
      serverRevision,
    });
  DatabaseSaveTrigger.triggerSave("sync_conflict");
}

export async function listConflicts(userId: string): Promise<SyncConflict[]> {
  return db()
    .select()
    .from(syncConflicts)
    .where(eq(syncConflicts.userId, userId))
    .orderBy(asc(syncConflicts.createdAt));
}

export async function getConflict(
  userId: string,
  id: number,
): Promise<SyncConflict | null> {
  const [row] = await db()
    .select()
    .from(syncConflicts)
    .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.id, id)))
    .limit(1);
  return row ?? null;
}

export async function deleteConflict(
  userId: string,
  id: number,
): Promise<void> {
  await db()
    .delete(syncConflicts)
    .where(and(eq(syncConflicts.userId, userId), eq(syncConflicts.id, id)));
  DatabaseSaveTrigger.triggerSave("sync_conflict");
}
