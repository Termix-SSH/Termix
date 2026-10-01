/**
 * Turning a stored row into its wire form and back.
 *
 * On the wire a row has plaintext secrets, a syncId, and syncIds in place of
 * every local numeric id it references. Local ids mean nothing on the other
 * side of a link, and secrets are encrypted with a key only this side has.
 */

import crypto from "crypto";
import type { SyncEntityReference, SyncRow } from "@termix/plugin-sdk/backend";
import { FieldCrypto } from "../utils/field-crypto.js";
import type { RegisteredSyncEntity } from "../plugins/sync-registry.js";

export type ResolveSyncId = (
  entityType: string,
  id: number,
) => Promise<string | null>;
export type ResolveId = (
  entityType: string,
  syncId: string,
) => Promise<number | null>;

/** Keys that describe where a row lives rather than what it says. */
const LOCATION_KEYS = ["id", "syncId", "createdAt", "updatedAt"];

export function singletonSyncId(entityType: string): string {
  return `${entityType}:singleton`;
}

interface JsonPath {
  column: string;
  steps: Array<{ key: string; each: boolean }>;
}

/** "jumpHosts[].hostId" -> column jumpHosts, then each item, then hostId. */
export function parseReferencePath(field: string): JsonPath | null {
  if (!field.includes(".") && !field.includes("[]")) return null;
  const parts = field.split(".");
  const head = parts.shift()!;
  const headEach = head.endsWith("[]");
  const column = headEach ? head.slice(0, -2) : head;
  const steps: JsonPath["steps"] = [];
  if (headEach) steps.push({ key: "", each: true });
  for (const part of parts) {
    const each = part.endsWith("[]");
    steps.push({ key: each ? part.slice(0, -2) : part, each });
  }
  return { column, steps };
}

async function rewritePath(
  value: unknown,
  steps: JsonPath["steps"],
  map: (leaf: unknown) => Promise<unknown>,
): Promise<unknown> {
  if (steps.length === 0) return map(value);
  const [step, ...rest] = steps;

  if (step.key === "" && step.each) {
    if (!Array.isArray(value)) return value;
    return Promise.all(value.map((item) => rewritePath(item, rest, map)));
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const object = value as Record<string, unknown>;
  if (!(step.key in object)) return value;

  const child = object[step.key];
  if (step.each) {
    if (!Array.isArray(child)) return value;
    return {
      ...object,
      [step.key]: await Promise.all(
        child.map((item) => rewritePath(item, rest, map)),
      ),
    };
  }
  return { ...object, [step.key]: await rewritePath(child, rest, map) };
}

/** Rewrites every leaf a JSON path points at, keeping the column's storage form. */
async function rewriteJsonColumn(
  row: SyncRow,
  path: JsonPath,
  map: (leaf: unknown) => Promise<unknown>,
): Promise<void> {
  const stored = row[path.column];
  if (stored == null || stored === "") return;

  let parsed: unknown = stored;
  const asString = typeof stored === "string";
  if (asString) {
    try {
      parsed = JSON.parse(stored as string);
    } catch {
      return;
    }
  }

  const rewritten = await rewritePath(parsed, path.steps, map);
  row[path.column] = asString ? JSON.stringify(rewritten) : rewritten;
}

function wireField(reference: SyncEntityReference): string {
  return reference.syncField ?? `${reference.field}SyncId`;
}

/** Local ids to syncIds. */
export async function serializeReferences(
  entity: RegisteredSyncEntity,
  row: SyncRow,
  resolveSyncId: ResolveSyncId,
): Promise<SyncRow> {
  const out = { ...row };
  for (const reference of entity.references ?? []) {
    const path = parseReferencePath(reference.field);
    if (path) {
      await rewriteJsonColumn(out, path, async (leaf) => {
        const id = typeof leaf === "string" ? Number(leaf) : leaf;
        if (typeof id !== "number" || !Number.isInteger(id)) return leaf;
        return (await resolveSyncId(reference.entityType, id)) ?? null;
      });
      continue;
    }
    const id = out[reference.field];
    out[wireField(reference)] =
      typeof id === "number"
        ? await resolveSyncId(reference.entityType, id)
        : null;
    delete out[reference.field];
  }
  return entity.serialize ? entity.serialize(out, resolveSyncId) : out;
}

/**
 * SyncIds back to local ids.
 *
 * A syncId with no local row keeps whatever the column already holds here
 * (`current`), rather than failing the whole row. That happens when the
 * target's category is not synced on this device, or it has not arrived yet.
 */
export async function deserializeReferences(
  entity: RegisteredSyncEntity,
  row: SyncRow,
  resolveId: ResolveId,
  current: SyncRow | null,
): Promise<SyncRow> {
  const out = { ...row };
  for (const reference of entity.references ?? []) {
    const path = parseReferencePath(reference.field);
    if (path) {
      await rewriteJsonColumn(out, path, async (leaf) => {
        if (typeof leaf !== "string" || !leaf) return leaf;
        const id = await resolveId(reference.entityType, leaf);
        if (id === null) return null;
        return reference.idType === "string" ? String(id) : id;
      });
      continue;
    }
    const field = wireField(reference);
    const syncId = out[field];
    delete out[field];
    delete out[reference.field];
    if (syncId == null || syncId === "") {
      out[reference.field] = null;
      continue;
    }
    if (typeof syncId !== "string") continue;
    const id = await resolveId(reference.entityType, syncId);
    if (id !== null) {
      out[reference.field] = id;
    } else if (current && reference.field in current) {
      out[reference.field] = current[reference.field];
    } else {
      out[reference.field] = null;
    }
  }
  return entity.deserialize ? entity.deserialize(out, resolveId) : out;
}

/**
 * Decrypts the entity's secret fields. Throws when one cannot be decrypted:
 * sending an empty value instead would wipe the secret on the other side.
 */
export function decryptFields(
  entity: RegisteredSyncEntity,
  row: SyncRow,
  key: Buffer | null,
): SyncRow {
  if (entity.encryptedFields.length === 0) return row;
  const out = { ...row };
  for (const field of entity.encryptedFields) {
    const value = out[field];
    if (typeof value !== "string" || !FieldCrypto.isEncrypted(value)) continue;
    if (!key) throw new Error("No data key to decrypt synced fields");
    out[field] = FieldCrypto.decryptField(value, key, String(row.id), field);
  }
  return out;
}

export function encryptFields(
  entity: RegisteredSyncEntity,
  row: SyncRow,
  key: Buffer | null,
  recordId: string,
): SyncRow {
  if (entity.encryptedFields.length === 0) return row;
  const out = { ...row };
  for (const field of entity.encryptedFields) {
    const value = out[field];
    if (typeof value !== "string" || !value) continue;
    if (FieldCrypto.isEncrypted(value)) continue;
    if (!key) throw new Error("No data key to encrypt synced fields");
    out[field] = FieldCrypto.encryptField(value, key, recordId, field);
  }
  return out;
}

/** What goes on the wire: no local ids, no owner, no fields that stay here. */
export function toWire(
  entity: RegisteredSyncEntity,
  row: SyncRow,
  syncId: string,
): SyncRow {
  const out = { ...row };
  delete out.id;
  delete out[entity.userColumn];
  if (entity.userColumn !== "userId") delete out.userId;
  for (const field of entity.readOnlyFields) delete out[field];
  out.syncId = syncId;
  return out;
}

/** What may be written from an inbound row. */
export function toWritable(
  entity: RegisteredSyncEntity,
  wire: SyncRow,
): SyncRow {
  const out = { ...wire };
  delete out.id;
  delete out.syncId;
  delete out.userId;
  delete out[entity.userColumn];
  delete out.createdAt;
  delete out.updatedAt;
  for (const field of entity.readOnlyFields) delete out[field];
  for (const field of entity.hashIgnore ?? []) delete out[field];
  return out;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.keys(object)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        if (object[key] !== undefined) acc[key] = stable(object[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Booleans are stored as 0/1 on SQLite and true/false elsewhere, and JSON
 * columns come back as text or parsed depending on the driver. Leveled here
 * so the same content always hashes the same.
 */
function normalize(value: unknown): unknown {
  if (value === true) return 1;
  if (value === false) return 0;
  if (value === undefined) return null;
  if (typeof value === "string" && /^[[{]/.test(value)) {
    try {
      return stable(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return stable(value);
}

/**
 * Content hash of a wire row, keyed so a stored hash cannot be used to guess
 * a weak secret it covers.
 */
export function hashWire(
  entity: RegisteredSyncEntity,
  wire: SyncRow,
  key: Buffer,
): string {
  const skip = new Set([
    ...LOCATION_KEYS,
    ...entity.readOnlyFields,
    ...(entity.hashIgnore ?? []),
  ]);
  const content: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(wire)) {
    if (skip.has(field)) continue;
    const normalized = normalize(value);
    if (normalized === null || normalized === "") continue;
    content[field] = normalized;
  }
  return crypto
    .createHmac("sha256", key)
    .update(JSON.stringify(stable(content)))
    .digest("hex");
}

/** Parents before children when an entity references itself. */
export function orderSelfReferences(
  entity: RegisteredSyncEntity,
  rows: SyncRow[],
): SyncRow[] {
  const self = (entity.references ?? []).find(
    (reference) =>
      reference.entityType === entity.type &&
      !parseReferencePath(reference.field),
  );
  if (!self) return rows;
  const field = wireField(self);
  const bySyncId = new Map(
    rows
      .filter((row) => typeof row.syncId === "string")
      .map((row) => [row.syncId as string, row]),
  );
  const ordered: SyncRow[] = [];
  const done = new Set<SyncRow>();
  const visiting = new Set<SyncRow>();
  const visit = (row: SyncRow) => {
    if (done.has(row) || visiting.has(row)) return;
    visiting.add(row);
    const parent = row[field];
    if (typeof parent === "string") {
      const parentRow = bySyncId.get(parent);
      if (parentRow) visit(parentRow);
    }
    visiting.delete(row);
    done.add(row);
    ordered.push(row);
  };
  rows.forEach(visit);
  return ordered;
}
