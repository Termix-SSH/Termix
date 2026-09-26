/**
 * Applying a desktop's pushed changes on the server.
 *
 * Each op names the revision its sender last saw. If the server has moved on
 * since, the op is a conflict and the server's version is sent back instead
 * of being overwritten. Every op gets its own result, so one bad row never
 * holds up the rest of the batch.
 */

import type { SyncRow } from "@termix/plugin-sdk/backend";
import { getEntity } from "../../plugins/sync-registry.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { syncLogger } from "../../utils/logger.js";
import {
  createResolvers,
  deleteStoredRow,
  loadWireRow,
  writeWireRow,
} from "../store.js";
import { allocateSeq, getRecord, putRecord, recordKey } from "../records.js";
import { orderSelfReferences } from "../wire.js";
import { reconcileUser } from "./feed.js";

export interface PushOp {
  entityType: string;
  syncId: string;
  baseRevision: number;
  op: "upsert" | "delete";
  row?: SyncRow;
}

export type PushResult =
  | { syncId: string; entityType: string; status: "ok"; revision: number }
  | {
      syncId: string;
      entityType: string;
      status: "conflict";
      revision: number;
      deleted: boolean;
      row: SyncRow | null;
    }
  | {
      syncId: string;
      entityType: string;
      status: "rejected";
      reason: string;
    };

export const MAX_PUSH_OPS = 500;

function isPushOp(value: unknown): value is PushOp {
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;
  return (
    typeof op.entityType === "string" &&
    typeof op.syncId === "string" &&
    op.syncId.length > 0 &&
    op.syncId.length <= 191 &&
    typeof op.baseRevision === "number" &&
    (op.op === "upsert" || op.op === "delete") &&
    (op.op === "delete" || (!!op.row && typeof op.row === "object"))
  );
}

export function parsePushOps(body: unknown): PushOp[] | null {
  const ops = (body as { ops?: unknown })?.ops;
  if (!Array.isArray(ops) || ops.length > MAX_PUSH_OPS) return null;
  return ops.every(isPushOp) ? ops : null;
}

/** Upserts in dependency order, then deletes in reverse, children first. */
export function orderOps(ops: PushOp[]): PushOp[] {
  const order = (op: PushOp) => getEntity(op.entityType)?.order ?? 1_000_000;
  const upserts = ops
    .filter((op) => op.op === "upsert")
    .sort((a, b) => order(a) - order(b));
  const deletes = ops
    .filter((op) => op.op === "delete")
    .sort((a, b) => order(b) - order(a));

  const orderedUpserts: PushOp[] = [];
  const byType = new Map<string, PushOp[]>();
  for (const op of upserts) {
    const list = byType.get(op.entityType) ?? [];
    list.push(op);
    byType.set(op.entityType, list);
  }
  for (const [type, list] of byType) {
    const entity = getEntity(type);
    if (!entity) {
      orderedUpserts.push(...list);
      continue;
    }
    const bySyncId = new Map(list.map((op) => [op.syncId, op]));
    const rows = orderSelfReferences(
      entity,
      list.map((op) => ({ ...(op.row as SyncRow), syncId: op.syncId })),
    );
    for (const row of rows) {
      orderedUpserts.push(bySyncId.get(row.syncId as string)!);
    }
  }
  return [...orderedUpserts, ...deletes];
}

/** Call inside withUserLock. */
export async function applyPush(
  userId: string,
  ops: PushOp[],
): Promise<PushResult[]> {
  const { wire } = await reconcileUser(userId, { force: true });
  const permissions = PermissionManager.getInstance();
  let missed = false;
  const resolvers = createResolvers(userId, () => {
    missed = true;
  });
  const results = new Map<string, PushResult>();
  // Rows written before something they point at, for a second pass.
  const retry: PushOp[] = [];

  for (const op of orderOps(ops)) {
    const key = recordKey(op.entityType, op.syncId);
    const base = { syncId: op.syncId, entityType: op.entityType };
    const entity = getEntity(op.entityType);
    if (!entity) {
      results.set(key, { ...base, status: "rejected", reason: "unknown_type" });
      continue;
    }
    if (entity.readOnly) {
      results.set(key, { ...base, status: "rejected", reason: "read_only" });
      continue;
    }

    const record = await getRecord(userId, op.entityType, op.syncId);
    const currentRevision = record?.revision ?? 0;
    if (op.baseRevision !== currentRevision) {
      results.set(key, {
        ...base,
        status: "conflict",
        revision: currentRevision,
        deleted: !!record?.deleted,
        row: record?.deleted ? null : (wire.get(key) ?? null),
      });
      continue;
    }

    const exists = !!record && !record.deleted;
    const permission =
      op.op === "delete"
        ? entity.permissions?.delete
        : exists
          ? entity.permissions?.update
          : entity.permissions?.create;
    if (permission && !(await permissions.hasPermission(userId, permission))) {
      results.set(key, { ...base, status: "rejected", reason: "permission" });
      continue;
    }

    try {
      if (op.op === "delete") {
        await deleteStoredRow(entity, userId, op.syncId);
        await putRecord(userId, op.entityType, op.syncId, {
          revision: currentRevision + 1,
          seq: await allocateSeq(),
          hash: null,
          deleted: true,
        });
        wire.delete(key);
        results.set(key, {
          ...base,
          status: "ok",
          revision: currentRevision + 1,
        });
        continue;
      }

      const row = { ...(op.row as SyncRow), syncId: op.syncId };
      if (entity.shouldSync && entity.shouldSync(row) === false) {
        results.set(key, { ...base, status: "rejected", reason: "not_synced" });
        continue;
      }
      missed = false;
      await writeWireRow(entity, userId, row, resolvers);
      if (missed) retry.push(op);
      const written = await loadWireRow(entity, userId, op.syncId, resolvers);
      await putRecord(userId, op.entityType, op.syncId, {
        revision: currentRevision + 1,
        seq: await allocateSeq(),
        hash: written?.hash ?? null,
        deleted: false,
      });
      if (written) wire.set(key, written.wire);
      results.set(key, {
        ...base,
        status: "ok",
        revision: currentRevision + 1,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      syncLogger.warn("Rejected a pushed sync change", {
        operation: "sync_push",
        userId,
        entityType: op.entityType,
        syncId: op.syncId,
        error: reason,
      });
      results.set(key, {
        ...base,
        status: "rejected",
        reason: `invalid: ${reason}`.slice(0, 500),
      });
    }
  }

  for (const op of retry) {
    const entity = getEntity(op.entityType)!;
    try {
      await writeWireRow(
        entity,
        userId,
        { ...(op.row as SyncRow), syncId: op.syncId },
        resolvers,
      );
      const written = await loadWireRow(entity, userId, op.syncId, resolvers);
      const record = await getRecord(userId, op.entityType, op.syncId);
      if (record && written) {
        await putRecord(userId, op.entityType, op.syncId, {
          revision: record.revision,
          seq: record.seq,
          hash: written.hash,
          deleted: false,
        });
      }
    } catch {
      // The first write stands.
    }
  }

  // Refresh the snapshot so the next pull serves what was just written.
  await reconcileUser(userId, { force: true });
  return ops.map(
    (op) =>
      results.get(recordKey(op.entityType, op.syncId)) ?? {
        syncId: op.syncId,
        entityType: op.entityType,
        status: "rejected",
        reason: "duplicate",
      },
  );
}
