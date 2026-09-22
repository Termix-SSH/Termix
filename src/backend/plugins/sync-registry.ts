/**
 * Which entities remote sync carries.
 *
 * Core registers its ten at boot and a plugin registers its own through
 * ctx.sync, so the list is built rather than hardcoded in four places. The
 * wire names are unchanged: existing tombstones and rows on the other side of
 * a pair match on those strings, so renaming one would orphan data.
 *
 * Order is dependency order, not declaration order. A row referencing another
 * entity is resolved by that entity's syncId, so the target has to exist on
 * the far side first. That is why every registration carries an explicit
 * order rather than relying on registration sequence.
 */

import { pluginLogger } from "../utils/logger.js";
import type { SyncEntityRegistration } from "@termix/plugin-sdk/backend";

export interface RegisteredSyncEntity extends SyncEntityRegistration {
  /** Which plugin registered it, or "core". */
  owner: string;
  order: number;
  userColumn: string;
  readOnlyFields: readonly string[];
  encryptedFields: readonly string[];
}

const entities = new Map<string, RegisteredSyncEntity>();

/** Core's own entities register under this owner. */
export const CORE_OWNER = "core";

export function registerEntity(
  owner: string,
  entity: SyncEntityRegistration,
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

  entities.set(entity.type, {
    ...entity,
    owner,
    order: entity.order ?? 100,
    userColumn: entity.userColumn ?? "userId",
    readOnlyFields: entity.readOnlyFields ?? [],
    encryptedFields: entity.encryptedFields ?? [],
  });

  return () => {
    const current = entities.get(entity.type);
    // Identity-checked: a plugin that restarted must not revoke the
    // registration its own restart installed.
    if (current && current.owner === owner) entities.delete(entity.type);
  };
}

export function getEntity(type: string): RegisteredSyncEntity | undefined {
  return entities.get(type);
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

/** The ordered wire names, which is what the Electron client syncs by. */
export function listEntityTypes(): string[] {
  return listEntities().map((entity) => entity.type);
}

export function unregisterByOwner(owner: string): void {
  for (const [type, entity] of [...entities]) {
    if (entity.owner === owner) entities.delete(type);
  }
}

export function resetSyncRegistry(): void {
  entities.clear();
}

/** Logged once at boot so a missing entity is visible without a debugger. */
export function logRegisteredEntities(): void {
  pluginLogger.info(`Sync entities: ${listEntityTypes().join(", ")}`, {
    operation: "sync_registry",
  });
}
