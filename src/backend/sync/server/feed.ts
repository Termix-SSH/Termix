/**
 * The server's change feed.
 *
 * Nothing records a change as it happens. Instead the reconciler compares
 * every synced row a user owns with sync_records and bumps the record of
 * anything new, changed or gone. That catches every write path, including
 * plugin tables, bulk routes and background jobs, without each of them having
 * to remember to report it.
 */

import type { Response } from "express";
import type { SyncRow } from "@termix-ssh/plugin-sdk/backend";
import { listEntities } from "../../plugins/sync-registry.js";
import { syncLogger } from "../../utils/logger.js";
import { registerCoreSyncEntities } from "../entities.js";
import { createResolvers, loadWireRows } from "../store.js";
import { allocateSeq, listRecords, putRecord, recordKey } from "../records.js";

const locks = new Map<string, Promise<unknown>>();

/** Runs one user's sync work at a time: reconcile and push must not interleave. */
export async function withUserLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  locks.set(userId, run);
  try {
    return await run;
  } finally {
    if (locks.get(userId) === run) locks.delete(userId);
  }
}

interface Snapshot {
  at: number;
  globalGeneration: number;
  userGeneration: number;
  wire: Map<string, SyncRow>;
}

const snapshots = new Map<string, Snapshot>();
const userGenerations = new Map<string, number>();
const dirtyUsers = new Set<string>();
const SNAPSHOT_TTL_MS = 60_000;
let globalGeneration = 0;
let globalDirty = false;

function userGenerationOf(userId: string): number {
  return userGenerations.get(userId) ?? 0;
}

export interface ReconcileResult {
  changed: boolean;
  /** Every live row on the wire, by recordKey. */
  wire: Map<string, SyncRow>;
}

/**
 * Brings the user's records up to date. Call inside withUserLock. Skipped
 * when nothing was written since the last run and it is recent, unless
 * forced.
 */
export async function reconcileUser(
  userId: string,
  options: { force?: boolean } = {},
): Promise<ReconcileResult> {
  const snapshot = snapshots.get(userId);
  const currentUserGen = userGenerationOf(userId);
  if (
    !options.force &&
    snapshot &&
    snapshot.globalGeneration === globalGeneration &&
    snapshot.userGeneration === currentUserGen &&
    Date.now() - snapshot.at < SNAPSHOT_TTL_MS
  ) {
    return { changed: false, wire: snapshot.wire };
  }

  registerCoreSyncEntities();
  const startedGlobalGen = globalGeneration;
  const startedUserGen = currentUserGen;
  const records = await listRecords(userId);
  const resolvers = createResolvers(userId);
  const wire = new Map<string, SyncRow>();
  let changed = false;

  for (const entity of listEntities()) {
    let loaded;
    try {
      loaded = await loadWireRows(entity, userId, resolvers);
    } catch (error) {
      // An entity that cannot load right now is left alone rather than read
      // as every row deleted.
      syncLogger.warn(`Could not read the ${entity.type} sync entity`, {
        operation: "sync_reconcile",
        entityType: entity.type,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const row of loaded.rows.values()) {
      const key = recordKey(entity.type, row.syncId);
      wire.set(key, row.wire);
      const record = records.get(key);
      if (record && !record.deleted && record.hash === row.hash) continue;
      await putRecord(userId, entity.type, row.syncId, {
        revision: (record?.revision ?? 0) + 1,
        seq: await allocateSeq(),
        hash: row.hash,
        deleted: false,
      });
      changed = true;
    }

    for (const record of records.values()) {
      if (record.entityType !== entity.type || record.deleted) continue;
      if (loaded.rows.has(record.syncId) || loaded.failed.has(record.syncId)) {
        continue;
      }
      if (entity.covers && !entity.covers(record.syncId)) continue;
      await putRecord(userId, entity.type, record.syncId, {
        revision: record.revision + 1,
        seq: await allocateSeq(),
        hash: null,
        deleted: true,
      });
      changed = true;
    }
  }

  snapshots.set(userId, {
    at: Date.now(),
    globalGeneration: startedGlobalGen,
    userGeneration: startedUserGen,
    wire,
  });
  if (changed) notifyListeners(userId);
  return { changed, wire };
}

const listeners = new Map<string, Set<Response>>();
let debounce: NodeJS.Timeout | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let sweep: NodeJS.Timeout | null = null;

function scheduleReconcile(): void {
  if (listeners.size === 0) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void reconcileListeners();
  }, 1500);
  debounce.unref?.();
}

/**
 * Something was written that may affect multiple users (e.g. host sharing,
 * RBAC/admin changes, or a write without a user context). Reconciles all
 * online listeners shortly after.
 */
export function markChanged(): void {
  globalGeneration++;
  if (listeners.size === 0) return;
  globalDirty = true;
  dirtyUsers.clear();
  scheduleReconcile();
}

/**
 * Something was written for a single user. Advances only that user's
 * generation and schedules reconciliation only for that user if online.
 */
export function markUserChanged(userId: string): void {
  userGenerations.set(userId, userGenerationOf(userId) + 1);
  if (!listeners.has(userId)) return;
  if (!globalDirty) dirtyUsers.add(userId);
  scheduleReconcile();
}

async function reconcileListeners(forceAll = false): Promise<void> {
  const reconcileAll = forceAll || globalDirty;
  const targets = reconcileAll
    ? [...listeners.keys()]
    : [...dirtyUsers].filter((userId) => listeners.has(userId));
  globalDirty = false;
  dirtyUsers.clear();

  for (const userId of targets) {
    try {
      await withUserLock(userId, () => reconcileUser(userId));
    } catch (error) {
      syncLogger.warn("Background sync reconcile failed", {
        operation: "sync_reconcile_background",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function notifyListeners(userId: string): void {
  const set = listeners.get(userId);
  if (!set) return;
  for (const res of set) {
    res.write(`event: change\ndata: {}\n\n`);
  }
}

export function addListener(userId: string, res: Response): () => void {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(res);
  ensureTimers();
  return () => {
    set!.delete(res);
    if (set!.size === 0) listeners.delete(userId);
  };
}

function ensureTimers(): void {
  if (!heartbeat) {
    heartbeat = setInterval(() => {
      for (const set of listeners.values()) {
        for (const res of set) res.write(`: ping\n\n`);
      }
    }, 25_000);
    heartbeat.unref?.();
  }
  if (!sweep) {
    // Background jobs write without a request; this catches them.
    sweep = setInterval(() => {
      globalGeneration++;
      void reconcileListeners(true);
    }, 60_000);
    sweep.unref?.();
  }
}

/** Test seam. */
export function resetFeed(): void {
  snapshots.clear();
  userGenerations.clear();
  dirtyUsers.clear();
  listeners.clear();
  locks.clear();
  globalGeneration = 0;
  globalDirty = false;
  for (const timer of [debounce, heartbeat, sweep]) {
    if (timer) clearTimeout(timer);
  }
  debounce = heartbeat = sweep = null;
}
