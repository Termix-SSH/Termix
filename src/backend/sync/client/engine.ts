/**
 * The linked desktop's side of sync.
 *
 * A pass pushes local edits, then pulls what changed on the server after the
 * saved cursor, then backfills any entity type this device has never pulled
 * (first link, a feature switched on, a category turned back on). Local
 * edits are found the same way the server finds changes: by comparing each
 * row's hash with the one recorded at the last sync.
 */

import os from "os";
import type { SyncRow } from "@termix/plugin-sdk/backend";
import {
  getEntity,
  listEntities,
  onEntitiesChanged,
  type RegisteredSyncEntity,
} from "../../plugins/sync-registry.js";
import { syncLogger } from "../../utils/logger.js";
import { sendCoreAlert } from "../../notify/core-notify.js";
import { registerCoreSyncEntities } from "../entities.js";
import {
  createResolvers,
  deleteStoredRow,
  loadWireRow,
  loadWireRows,
  writeWireRow,
} from "../store.js";
import {
  listRecords,
  putRecord,
  recordKey,
  saveConflict,
  setRecordError,
  type SyncRecord,
} from "../records.js";
import { orderSelfReferences } from "../wire.js";
import { onLocalWrite } from "../server/change-watcher.js";
import { getLink, updateLink, type SyncLink } from "./link-store.js";
import { RemoteError, remoteFetch, remoteJson } from "./http.js";
import { mirrorPlugins } from "./plugins.js";
import { applyElectronProxyConfig } from "./electron-proxy.js";

export interface RemoteChange {
  seq: number;
  entityType: string;
  syncId: string;
  revision: number;
  deleted: boolean;
  row: SyncRow | null;
}

interface ChangesPage {
  changes: RemoteChange[];
  nextCursor: number;
  hasMore: boolean;
  entityTypes: Array<{
    type: string;
    owner: string;
    order: number;
    readOnly: boolean;
  }>;
}

interface PushOp {
  entityType: string;
  syncId: string;
  baseRevision: number;
  op: "upsert" | "delete";
  row?: SyncRow;
}

type PushResult =
  | { syncId: string; entityType: string; status: "ok"; revision: number }
  | {
      syncId: string;
      entityType: string;
      status: "conflict";
      revision: number;
      deleted: boolean;
      row: SyncRow | null;
    }
  | { syncId: string; entityType: string; status: "rejected"; reason: string };

const MAX_BATCH_OPS = 200;
const MAX_BATCH_BYTES = 1_000_000;
const MAX_PAGES = 500;
const SAFETY_INTERVAL_MS = 5 * 60_000;
const REFRESH_CHECK_MS = 24 * 60 * 60_000;
const DELETED_HASH = "deleted";

export interface EngineState {
  running: boolean;
  /** Local changes found in the last pass that the server has not taken. */
  pending: number;
  /** Entity types the server runs, from the last pull. */
  serverTypes: Array<{ type: string; owner: string; readOnly: boolean }>;
  lastPassAt: string | null;
}

/** An entity this device could sync: registered here, and on the server. */
function syncable(
  entity: RegisteredSyncEntity,
  link: SyncLink,
  serverTypes: Set<string> | null,
): boolean {
  if (link.disabledTypes.includes(entity.type)) return false;
  if (serverTypes && !serverTypes.has(entity.type)) return false;
  return true;
}

function sortChanges(changes: RemoteChange[]): RemoteChange[] {
  const byType = new Map<string, RemoteChange[]>();
  for (const change of changes) {
    const list = byType.get(change.entityType) ?? [];
    list.push(change);
    byType.set(change.entityType, list);
  }
  const types = [...byType.keys()].sort(
    (a, b) => (getEntity(a)?.order ?? 1e6) - (getEntity(b)?.order ?? 1e6),
  );
  const out: RemoteChange[] = [];
  for (const type of types) {
    const list = byType.get(type)!;
    const entity = getEntity(type);
    // Only the latest record of each row matters.
    const latest = new Map<string, RemoteChange>();
    for (const change of list) latest.set(change.syncId, change);
    const live = [...latest.values()].filter((change) => !change.deleted);
    const gone = [...latest.values()].filter((change) => change.deleted);
    if (entity) {
      const bySyncId = new Map(live.map((change) => [change.syncId, change]));
      const ordered = orderSelfReferences(
        entity,
        live.map((change) => ({
          ...(change.row ?? {}),
          syncId: change.syncId,
        })),
      );
      out.push(...ordered.map((row) => bySyncId.get(row.syncId as string)!));
    } else {
      out.push(...live);
    }
    out.push(...gone);
  }
  return out;
}

export class SyncEngine {
  private running = false;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  private safety: NodeJS.Timeout | null = null;
  private backoffMs = 0;
  private events: AbortController | null = null;
  private eventsFor: string | null = null;
  private lastRefreshCheck = 0;
  private serverTypes: Set<string> | null = null;
  private stopFns: Array<() => void> = [];
  private alerted = false;
  readonly state: EngineState = {
    running: false,
    pending: 0,
    serverTypes: [],
    lastPassAt: null,
  };

  start(): void {
    if (this.safety) return;
    registerCoreSyncEntities();
    this.safety = setInterval(() => this.request(0), SAFETY_INTERVAL_MS);
    this.safety.unref?.();
    this.stopFns.push(onLocalWrite(() => this.request(2000)));
    // A plugin that came up may bring entity types to backfill.
    this.stopFns.push(onEntitiesChanged(() => this.request(3000)));
    this.request(3000);
  }

  stop(): void {
    if (this.safety) clearInterval(this.safety);
    if (this.timer) clearTimeout(this.timer);
    this.safety = this.timer = null;
    this.closeEvents();
    for (const stop of this.stopFns.splice(0)) stop();
  }

  /** Runs a pass after `delayMs`, folding requests that arrive meanwhile. */
  request(delayMs = 0): void {
    if (this.timer) {
      if (delayMs > 0) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delayMs);
    this.timer.unref?.();
  }

  /** Runs a pass now and waits for it. */
  async syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      while (this.running) await new Promise((r) => setTimeout(r, 100));
      return;
    }
    await this.run();
  }

  /** Forgets what the server runs, after a relink or unlink. */
  reset(): void {
    this.serverTypes = null;
    this.state.serverTypes = [];
    this.state.pending = 0;
    this.alerted = false;
    this.backoffMs = 0;
    this.closeEvents();
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.state.running = true;
    try {
      await this.pass();
    } finally {
      this.running = this.state.running = false;
      this.state.lastPassAt = new Date().toISOString();
      if (this.again) {
        this.again = false;
        this.request(0);
      }
    }
  }

  private async pass(): Promise<void> {
    const link = await getLink();
    if (!link?.sessionToken) {
      this.closeEvents();
      return;
    }
    await updateLink({ status: "syncing" });

    try {
      await this.refreshSession(link);
      const fresh = (await getLink())!;
      await mirrorPlugins(fresh);

      // A first pass pulls before it pushes, so rows both sides already
      // have are matched up instead of sent back as edits.
      const firstPass = fresh.knownTypes.length === 0;
      if (!firstPass) {
        await this.push(fresh);
        await this.pull(fresh);
      }
      await this.backfill((await getLink())!);
      if (firstPass) await this.push((await getLink())!);

      this.backoffMs = 0;
      this.alerted = false;
      await updateLink({
        status: "idle",
        lastError: null,
        lastSyncAt: new Date().toISOString(),
      });
      const done = (await getLink())!;
      await applyElectronProxyConfig(done).catch(() => {});
      this.openEvents(done);
    } catch (error) {
      await this.fail(error);
    }
  }

  private async fail(error: unknown): Promise<void> {
    const remote = error instanceof RemoteError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    syncLogger.warn("Sync pass failed", {
      operation: "sync_pass",
      kind: remote?.kind ?? "internal",
      error: message,
    });

    if (remote?.kind === "signed_out") {
      const link = await updateLink({
        status: "signed_out",
        lastError: message,
      });
      await applyElectronProxyConfig(link).catch(() => {});
      this.closeEvents();
      if (!this.alerted) {
        this.alerted = true;
        await sendCoreAlert({
          title: "Sync is paused",
          body: "This device was signed out of the server it syncs with. Sign in again from Sync to keep going.",
          severity: "warning",
          category: "termix.sync.signed_out",
          dedupeKey: "sync:signed_out",
          audience: "admins",
          link: { tab: "sync" },
        });
      }
      return;
    }

    const offline = remote?.kind === "offline";
    await updateLink({
      status: offline ? "offline" : "error",
      lastError: message,
    });
    this.backoffMs = Math.min(
      this.backoffMs ? this.backoffMs * 2 : 15_000,
      10 * 60_000,
    );
    this.request(this.backoffMs);
  }

  private async refreshSession(link: SyncLink): Promise<void> {
    if (Date.now() - this.lastRefreshCheck < REFRESH_CHECK_MS) return;
    const result = await remoteJson<{ token: string | null }>(
      link,
      "/sync/v2/session/refresh",
      { method: "POST", body: {} },
    );
    this.lastRefreshCheck = Date.now();
    if (result.token) await updateLink({ sessionToken: result.token });
  }

  /** Local rows the server does not have in this form yet. */
  async outbox(link: SyncLink): Promise<{
    ops: PushOp[];
    hashes: Map<string, string>;
  }> {
    const records = await listRecords(link.userId);
    const resolvers = createResolvers(link.userId);
    const ops: PushOp[] = [];
    const hashes = new Map<string, string>();

    for (const entity of listEntities()) {
      if (entity.readOnly) continue;
      if (!link.knownTypes.includes(entity.type)) continue;
      if (!syncable(entity, link, this.serverTypes)) continue;

      const { rows, failed } = await loadWireRows(
        entity,
        link.userId,
        resolvers,
      );
      for (const row of rows.values()) {
        const key = recordKey(entity.type, row.syncId);
        const record = records.get(key);
        if (record && !record.deleted && record.hash === row.hash) continue;
        if (record?.errorHash === row.hash) continue;
        ops.push({
          entityType: entity.type,
          syncId: row.syncId,
          baseRevision: record?.revision ?? 0,
          op: "upsert",
          row: row.wire,
        });
        hashes.set(key, row.hash);
      }

      for (const record of records.values()) {
        if (record.entityType !== entity.type || record.deleted) continue;
        if (record.revision === 0) continue;
        if (rows.has(record.syncId) || failed.has(record.syncId)) continue;
        if (entity.covers && !entity.covers(record.syncId)) continue;
        if (record.errorHash === DELETED_HASH) continue;
        ops.push({
          entityType: entity.type,
          syncId: record.syncId,
          baseRevision: record.revision,
          op: "delete",
        });
      }
    }
    return { ops, hashes };
  }

  private async push(link: SyncLink): Promise<void> {
    const { ops, hashes } = await this.outbox(link);
    this.state.pending = ops.length;
    if (ops.length === 0) return;

    for (const batch of batches(ops)) {
      const { results } = await remoteJson<{ results: PushResult[] }>(
        link,
        "/sync/v2/push",
        { method: "POST", body: { ops: batch }, timeoutMs: 120_000 },
      );
      const byKey = new Map(
        batch.map((op) => [recordKey(op.entityType, op.syncId), op]),
      );
      for (const result of results) {
        const key = recordKey(result.entityType, result.syncId);
        const op = byKey.get(key);
        if (!op) continue;
        await this.settle(link, op, result, hashes.get(key) ?? null);
      }
      this.state.pending = Math.max(0, this.state.pending - batch.length);
    }
  }

  private async settle(
    link: SyncLink,
    op: PushOp,
    result: PushResult,
    hash: string | null,
  ): Promise<void> {
    const userId = link.userId;
    const entity = getEntity(op.entityType);
    if (!entity) return;

    if (result.status === "ok") {
      await putRecord(userId, op.entityType, op.syncId, {
        revision: result.revision,
        hash: op.op === "delete" ? null : hash,
        deleted: op.op === "delete",
      });
      return;
    }

    if (result.status === "rejected") {
      await setRecordError(
        userId,
        op.entityType,
        op.syncId,
        result.reason,
        hash ?? DELETED_HASH,
      );
      return;
    }

    // Conflict: the server moved on since this device last saw the row. Its
    // version wins here, and a local edit it replaced is kept for the user.
    if (op.op === "upsert" && op.row) {
      await saveConflict(
        userId,
        op.entityType,
        op.syncId,
        op.row,
        result.revision,
      );
    }
    const resolvers = createResolvers(userId);
    if (result.deleted || !result.row) {
      await deleteStoredRow(entity, userId, op.syncId);
      await putRecord(userId, op.entityType, op.syncId, {
        revision: result.revision,
        hash: null,
        deleted: true,
      });
      return;
    }
    await writeWireRow(
      entity,
      userId,
      { ...result.row, syncId: op.syncId },
      resolvers,
    );
    const written = await loadWireRow(entity, userId, op.syncId, resolvers);
    await putRecord(userId, op.entityType, op.syncId, {
      revision: result.revision,
      hash: written?.hash ?? null,
      deleted: false,
    });
  }

  private async fetchChanges(
    link: SyncLink,
    cursor: number,
    types?: string[],
  ): Promise<{ changes: RemoteChange[]; cursor: number }> {
    const all: RemoteChange[] = [];
    let next = cursor;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({
        cursor: String(next),
        limit: "1000",
      });
      if (types?.length) query.set("types", types.join(","));
      const result = await remoteJson<ChangesPage>(
        link,
        `/sync/v2/changes?${query.toString()}`,
        { timeoutMs: 120_000 },
      );
      all.push(...result.changes);
      next = result.nextCursor;
      this.serverTypes = new Set(result.entityTypes.map((entry) => entry.type));
      this.state.serverTypes = result.entityTypes.map((entry) => ({
        type: entry.type,
        owner: entry.owner,
        readOnly: entry.readOnly,
      }));
      if (!result.hasMore) break;
    }
    return { changes: all, cursor: next };
  }

  private async pull(link: SyncLink): Promise<void> {
    const { changes, cursor } = await this.fetchChanges(link, link.cursor);
    const known = new Set(link.knownTypes);
    await this.apply(
      link,
      changes.filter(
        (change) =>
          known.has(change.entityType) &&
          !link.disabledTypes.includes(change.entityType),
      ),
      false,
    );
    await updateLink({ cursor });
  }

  /** Pulls every row of types this device has not pulled before. */
  private async backfill(link: SyncLink): Promise<void> {
    if (!this.serverTypes) {
      await this.fetchChanges(link, Number.MAX_SAFE_INTEGER);
    }
    const fresh = listEntities()
      .map((entity) => entity.type)
      .filter(
        (type) =>
          !link.knownTypes.includes(type) &&
          !link.disabledTypes.includes(type) &&
          this.serverTypes?.has(type),
      );
    if (fresh.length === 0) return;

    const { changes, cursor } = await this.fetchChanges(link, 0, fresh);
    await this.apply(link, changes, true);
    const current = (await getLink())!;
    await updateLink({
      knownTypes: [...new Set([...current.knownTypes, ...fresh])],
      // On a first pass the backfill is the whole pull, so it sets the cursor.
      ...(link.knownTypes.length === 0 ? { cursor } : {}),
    });
  }

  /**
   * Writes pulled changes. `adopt` is for a first pull of a type: a local row
   * with no record yet takes the server's version without a conflict.
   */
  private async apply(
    link: SyncLink,
    changes: RemoteChange[],
    adopt: boolean,
  ): Promise<void> {
    if (changes.length === 0) return;
    const userId = link.userId;
    const records = await listRecords(userId);
    let missed = false;
    const resolvers = createResolvers(userId, () => {
      missed = true;
    });
    const retry: RemoteChange[] = [];

    for (const change of sortChanges(changes)) {
      const entity = getEntity(change.entityType);
      if (!entity) continue;
      const key = recordKey(change.entityType, change.syncId);
      const record = records.get(key);
      if (record && record.revision >= change.revision) continue;

      try {
        if (!entity.readOnly) {
          await this.keepLocalEdit(
            entity,
            userId,
            change,
            record,
            adopt,
            resolvers,
          );
        }
        if (change.deleted) {
          await deleteStoredRow(entity, userId, change.syncId);
          await putRecord(userId, change.entityType, change.syncId, {
            revision: change.revision,
            hash: null,
            deleted: true,
          });
          continue;
        }
        missed = false;
        await writeWireRow(
          entity,
          userId,
          { ...(change.row ?? {}), syncId: change.syncId },
          resolvers,
        );
        if (missed) retry.push(change);
        await this.recordApplied(entity, userId, change, resolvers);
      } catch (error) {
        syncLogger.warn("Could not apply a synced change", {
          operation: "sync_apply",
          entityType: change.entityType,
          syncId: change.syncId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Rows that pointed at something written later in the same pull.
    for (const change of retry) {
      const entity = getEntity(change.entityType)!;
      try {
        await writeWireRow(
          entity,
          userId,
          { ...(change.row ?? {}), syncId: change.syncId },
          resolvers,
        );
        await this.recordApplied(entity, userId, change, resolvers);
      } catch {
        // The first write stands.
      }
    }
  }

  private async recordApplied(
    entity: RegisteredSyncEntity,
    userId: string,
    change: RemoteChange,
    resolvers: ReturnType<typeof createResolvers>,
  ): Promise<void> {
    const written = entity.readOnly
      ? null
      : await loadWireRow(entity, userId, change.syncId, resolvers);
    await putRecord(userId, change.entityType, change.syncId, {
      revision: change.revision,
      hash: written?.hash ?? null,
      deleted: false,
    });
  }

  /** Saves a local edit the incoming change is about to replace. */
  private async keepLocalEdit(
    entity: RegisteredSyncEntity,
    userId: string,
    change: RemoteChange,
    record: SyncRecord | undefined,
    adopt: boolean,
    resolvers: ReturnType<typeof createResolvers>,
  ): Promise<void> {
    if (!record && adopt) return;
    const local = await loadWireRow(
      entity,
      userId,
      change.syncId,
      resolvers,
    ).catch(() => null);
    if (!local) return;
    if (record && !record.deleted && record.hash === local.hash) return;
    await saveConflict(
      userId,
      change.entityType,
      change.syncId,
      local.wire,
      change.revision,
    );
  }

  private openEvents(link: SyncLink): void {
    const key = `${link.serverUrl}|${link.sessionToken}`;
    if (this.events && this.eventsFor === key) return;
    this.closeEvents();
    const controller = new AbortController();
    this.events = controller;
    this.eventsFor = key;
    void this.listen(link, controller);
  }

  private closeEvents(): void {
    this.events?.abort();
    this.events = null;
    this.eventsFor = null;
  }

  private async listen(
    link: SyncLink,
    controller: AbortController,
  ): Promise<void> {
    try {
      const response = await remoteFetch(link, "/sync/v2/events", {
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(`HTTP ${response.status}`);
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (/^event: change$/m.test(block)) this.request(500);
        }
      }
    } catch {
      // Dropped or refused: the safety interval still syncs, and the next
      // successful pass reopens the stream.
    }
    if (this.events === controller) {
      this.events = null;
      this.eventsFor = null;
      if (!controller.signal.aborted) {
        setTimeout(() => this.request(0), 30_000).unref?.();
      }
    }
  }

  /** Where the link's proxy settings have to reach outside the backend. */
  async applyProxyConfig(): Promise<void> {
    await applyElectronProxyConfig(await getLink());
  }
}

function* batches(ops: PushOp[]): Generator<PushOp[]> {
  let batch: PushOp[] = [];
  let bytes = 0;
  for (const op of ops) {
    const size = JSON.stringify(op).length;
    if (
      batch.length > 0 &&
      (batch.length >= MAX_BATCH_OPS || bytes + size > MAX_BATCH_BYTES)
    ) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(op);
    bytes += size;
  }
  if (batch.length > 0) yield batch;
}

let engine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!engine) engine = new SyncEngine();
  return engine;
}

/** Starts syncing on a desktop. A server install never links. */
export function startDesktopSync(): void {
  if (process.env.ELECTRON_EMBEDDED !== "true") return;
  const instance = getSyncEngine();
  instance.start();
  void instance.applyProxyConfig().catch(() => {});
}

export function defaultDeviceName(): string {
  return os.hostname() || "Termix Desktop";
}
