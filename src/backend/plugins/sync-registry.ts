/**
 * Which entities sync between a linked desktop and its server.
 *
 * Core registers its own at boot and a plugin registers its own through
 * ctx.sync, so the list is built rather than hardcoded. The wire names are
 * part of the protocol: records on both sides match on them, so renaming one
 * orphans data.
 *
 * Order is dependency order, not declaration order. A row referencing another
 * entity is resolved by that entity's syncId, so the target has to be written
 * first. That is why every registration carries an explicit order.
 */

import type {
  SyncEntityRegistration,
  SyncRow,
} from "@termix/plugin-sdk/backend";

/** Core-only extras a plugin registration cannot set. */
export interface CoreSyncEntityOptions {
  /** Server-to-desktop only. A desktop never pushes it. */
  readOnly?: boolean;
  /**
   * Builds the user's rows instead of reading `table`, for data that is not
   * a table row the user owns (hosts shared with them, plugin settings).
   * Rows come back already on the wire: plaintext, with a syncId.
   */
  load?: (userId: string) => Promise<SyncRow[]>;
  /** Writes an inbound row, for an entity with `load`. */
  write?: (userId: string, wire: SyncRow) => Promise<void>;
  /** Deletes a row by syncId, for an entity with `load`. */
  erase?: (userId: string, syncId: string) => Promise<void>;
  /**
   * Whether `load` would have returned this syncId if it existed. A row
   * `load` cannot see right now (its plugin is off) is not a delete.
   */
  covers?: (syncId: string) => boolean;
  /** Keys kept off the content hash and out of writes. */
  hashIgnore?: readonly string[];
  /**
   * Widens reference lookups past rows the user owns, e.g. a credential
   * shared with them is a valid target for their host's credentialId.
   */
  canReference?: (
    userId: string,
    ownerId: string,
    id: number,
  ) => Promise<boolean>;
}

export interface RegisteredSyncEntity
  extends SyncEntityRegistration, CoreSyncEntityOptions {
  /** Which plugin registered it, or "core". */
  owner: string;
  order: number;
  userColumn: string;
  readOnlyFields: readonly string[];
  encryptedFields: readonly string[];
}

const entities = new Map<string, RegisteredSyncEntity>();
const listeners = new Set<() => void>();

/** Core's own entities register under this owner. */
export const CORE_OWNER = "core";

export function registerEntity(
  owner: string,
  entity: SyncEntityRegistration,
  core: CoreSyncEntityOptions = {},
): () => void {
  if (!entity.type) {
    throw new Error("A sync entity needs a type");
  }

  const existing = entities.get(entity.type);
  if (existing && existing.owner !== owner) {
    throw new Error(
      `Sync entity "${entity.type}" is already registered by "${existing.owner}"`,
    );
  }

  const registered: RegisteredSyncEntity = {
    ...entity,
    ...(owner === CORE_OWNER ? core : {}),
    owner,
    order: entity.order ?? 100,
    userColumn: entity.userColumn ?? "userId",
    readOnlyFields: entity.readOnlyFields ?? [],
    encryptedFields: entity.encryptedFields ?? [],
  };
  entities.set(entity.type, registered);
  notify();

  return () => {
    // Identity-checked: a plugin that restarted must not revoke the
    // registration its own restart installed.
    if (entities.get(entity.type) === registered) {
      entities.delete(entity.type);
      notify();
    }
  };
}

export function getEntity(type: string): RegisteredSyncEntity | undefined {
  const direct = entities.get(type);
  if (direct) return direct;
  for (const entity of entities.values()) {
    if (entity.answersTo?.includes(type)) return entity;
  }
  return undefined;
}

export function hasEntity(type: string): boolean {
  return entities.has(type);
}

/** Every entity, in dependency order. */
export function listEntities(): RegisteredSyncEntity[] {
  return [...entities.values()].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.type.localeCompare(b.type);
  });
}

export function listEntityTypes(): string[] {
  return listEntities().map((entity) => entity.type);
}

export function unregisterByOwner(owner: string): void {
  let changed = false;
  for (const [type, entity] of [...entities]) {
    if (entity.owner === owner) {
      entities.delete(type);
      changed = true;
    }
  }
  if (changed) notify();
}

/** Called whenever the set of entities changes (a plugin came or went). */
export function onEntitiesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A listener's failure is its own problem.
    }
  }
}

export function resetSyncRegistry(): void {
  entities.clear();
}
