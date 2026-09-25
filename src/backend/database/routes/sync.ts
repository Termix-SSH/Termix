import express, { type Request, type Response } from "express";
import { and, eq, type SQL } from "drizzle-orm";
import { hosts } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { databaseLogger } from "../../utils/logger.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import {
  createCurrentRepositoryContext,
  createCurrentSyncTombstoneRepository,
} from "../repositories/factory.js";
import type { SyncEntityType } from "../repositories/sync-tombstone-repository.js";
import {
  getEntity,
  hasEntity,
  listEntities,
} from "../../plugins/sync-registry.js";
import {
  ENCRYPTED_ENTITY_TABLES,
  registerCoreSyncEntities,
} from "./sync-entities.js";
import {
  deserializeSyncReferences,
  orderSyncRows,
  serializeSyncReferences,
  type SyncReferenceEntity,
} from "./sync-references.js";
import { timestampAtOrAfter } from "../sync-timestamp.js";
import {
  insertReturningWhere,
  updateReturning,
} from "../repositories/returning.js";
import { validateParentHostId } from "./host-parent-validation.js";
import {
  exportHostPluginSettings,
  importHostPluginSettings,
} from "./sync-host-plugin-settings.js";

// Primed at import so every consumer of this module - the routes below, the
// reference resolvers, the Electron entity-types endpoint - sees the same
// registry regardless of which one runs first.
registerCoreSyncEntities();

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * What a sync entity looks like once it is registered.
 *
 * The table was a hand-maintained union of ten concrete drizzle types, which a
 * plugin-provided table could never join. It is the same deliberate
 * approximation repositories/database-context.ts documents: the query-builder
 * surface used here is identical across the engines and across tables, and
 * every use already casts to reach .syncId and .updatedAt.
 */
type SyncTable = typeof hosts;

function entityConfig(entityType: SyncEntityType) {
  const entity = getEntity(entityType);
  if (!entity) {
    throw new Error(`Unknown sync entity "${entityType}"`);
  }
  return {
    table: entity.table as SyncTable,
    readOnlyFields: entity.readOnlyFields,
    singleton: entity.singleton === true,
    shouldSync: (row: Record<string, unknown>) => isSyncedRow(entityType, row),
  };
}

/**
 * Whether a row takes part in sync. An entity can leave some of its rows out
 * (a per-install "last session"): they are not pulled, and a push, update or
 * delete aimed at one is refused.
 */
export function isSyncedRow(
  entityType: string,
  row: Record<string, unknown>,
): boolean {
  const entity = getEntity(entityType);
  if (!entity?.shouldSync) return true;
  return entity.shouldSync(row) !== false;
}

type RepositoryContext = ReturnType<typeof createCurrentRepositoryContext>;

export function isValidEntityType(value: unknown): value is SyncEntityType {
  if (typeof value !== "string") return false;
  registerCoreSyncEntities();
  return hasEntity(value);
}

/**
 * Locates the stored row a sync payload corresponds to.
 *
 * Read and write have to agree on this. A singleton entity is keyed on its
 * owner rather than a sync id, and `user_preferences` — the only singleton —
 * has no `id` column at all, so an update cannot fall back to one: `table.id`
 * is undefined there and drizzle emits `WHERE  = ?`.
 */
export function locateSyncRow(
  entityType: SyncEntityType,
  userId: string,
  syncId: string,
): SQL {
  const { table, singleton } = entityConfig(entityType);

  if (singleton) {
    return eq(table.userId, userId);
  }

  return and(
    eq((table as typeof hosts).syncId, syncId),
    eq(table.userId, userId),
  )!;
}

/**
 * The syncId of a referenced row.
 *
 * Generic over the registry rather than an if/else over three known entities.
 * The old chain ended in an unguarded else that returned vaultProfiles, so a
 * fourth reference target would have silently resolved against the wrong
 * table; an unregistered entity is an error here instead.
 */
async function findReferenceSyncId(
  context: RepositoryContext,
  entityType: SyncReferenceEntity,
  id: number,
  userId: string,
): Promise<string | null> {
  const { table } = entityConfig(entityType as SyncEntityType);
  const [row] = await context.drizzle
    .select({ syncId: table.syncId })
    .from(table)
    .where(and(eq(table.id, id), eq(table.userId, userId)))
    .limit(1);
  return row?.syncId ?? null;
}

async function findReferenceId(
  context: RepositoryContext,
  entityType: SyncReferenceEntity,
  syncId: string,
  userId: string,
): Promise<number | null> {
  const { table } = entityConfig(entityType as SyncEntityType);
  const [row] = await context.drizzle
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.syncId, syncId), eq(table.userId, userId)))
    .limit(1);
  return row?.id ?? null;
}

function requireUserDataKey(userId: string): Buffer {
  return DataCrypto.validateUserAccess(userId);
}

function decryptIfNeeded(
  entityType: SyncEntityType,
  row: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const tableName = ENCRYPTED_ENTITY_TABLES[entityType];
  if (!tableName) return row;
  const userDataKey = DataCrypto.getUserDataKey(userId);
  if (!userDataKey) return row;
  return DataCrypto.decryptRecord(
    tableName,
    row,
    userId,
    userDataKey,
  ) as Record<string, unknown>;
}

function encryptIfNeeded(
  entityType: SyncEntityType,
  row: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const tableName = ENCRYPTED_ENTITY_TABLES[entityType];
  if (!tableName) return row;
  const userDataKey = requireUserDataKey(userId);
  return DataCrypto.encryptRecord(
    tableName,
    row,
    userId,
    userDataKey,
  ) as Record<string, unknown>;
}

export function stripWritePayload(
  entityType: SyncEntityType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const { readOnlyFields } = entityConfig(entityType);
  const clean = { ...payload };
  delete clean.id;
  delete clean.userId;
  delete clean.syncId;
  for (const field of readOnlyFields) delete clean[field];
  return clean;
}

/**
 * @openapi
 * /sync/entity-types:
 *   get:
 *     summary: List the entity types this server syncs, in dependency order
 *     description: The desktop app syncs the entities in the order returned here, because an entity referenced by another has to exist on the far side first. A server that predates this endpoint returns 404 and the client falls back to its built-in list.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The ordered entity types.
 *       500:
 *         description: Failed to list entity types.
 */
router.get(
  "/entity-types",
  authenticateJWT,
  async (_req: Request, res: Response) => {
    try {
      registerCoreSyncEntities();
      return res.json({
        entityTypes: listEntities().map((entity) => ({
          type: entity.type,
          order: entity.order,
          singleton: entity.singleton === true,
        })),
      });
    } catch (error) {
      databaseLogger.error("Failed to list sync entity types", error, {
        operation: "sync_entity_types",
      });
      return res.status(500).json({ error: "Failed to list entity types" });
    }
  },
);

/**
 * @openapi
 * /sync/{entityType}:
 *   get:
 *     summary: Pull synced rows for an entity type
 *     description: Returns rows owned by the authenticated user whose updatedAt is newer than `since` (or all rows if omitted). Used by the desktop app's remote sync engine to reconcile the embedded backend against a connected remote server.
 *     tags:
 *       - Sync
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rows updated since the given timestamp.
 *       400:
 *         description: Unknown entity type.
 *       500:
 *         description: Failed to fetch rows.
 */
router.get(
  "/:entityType",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const entityType = req.params.entityType;
    if (!isValidEntityType(entityType)) {
      return res.status(400).json({ error: "Unknown entity type" });
    }
    const since =
      typeof req.query.since === "string" && req.query.since
        ? req.query.since
        : null;

    try {
      const { table, singleton, shouldSync } = entityConfig(entityType);
      const context = createCurrentRepositoryContext();
      const conditions = [eq(table.userId, userId)];
      if (since && "updatedAt" in table) {
        conditions.push(
          timestampAtOrAfter((table as typeof hosts).updatedAt, since),
        );
      }

      const rows = await context.drizzle
        .select()
        .from(table as typeof hosts)
        .where(and(...conditions));

      const synced = (rows as Record<string, unknown>[]).filter(shouldSync);

      const decrypted = await Promise.all(
        synced.map(async (row) => {
          const result = await serializeSyncReferences(
            entityType,
            decryptIfNeeded(entityType, row as Record<string, unknown>, userId),
            (referenceType, id) =>
              findReferenceSyncId(context, referenceType, id, userId),
          );
          if (entityType === "hosts") {
            result.pluginSettings = await exportHostPluginSettings(
              row.id as number,
            );
          }
          return singleton
            ? { ...result, syncId: `${entityType}:singleton` }
            : result;
        }),
      );

      res.json({ rows: orderSyncRows(entityType, decrypted) });
    } catch (err) {
      databaseLogger.error(`Failed to pull sync rows for ${entityType}`, err, {
        operation: "sync_pull",
        entityType,
        userId,
      });
      res.status(500).json({ error: "Failed to fetch rows" });
    }
  },
);

/**
 * @openapi
 * /sync/tombstones:
 *   post:
 *     summary: Report a deletion from the other side of a sync pair
 *     description: Applies a remote deletion locally (if the row still exists) and records the tombstone so future pulls stay consistent.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: Deletion applied (or row already absent).
 *       400:
 *         description: Unknown entity type or missing syncId.
 *       500:
 *         description: Failed to apply deletion.
 */
router.post(
  "/tombstones",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const entityType = req.body?.entityType;
    const syncId = req.body?.syncId;
    if (
      !isValidEntityType(entityType) ||
      typeof syncId !== "string" ||
      !syncId
    ) {
      return res.status(400).json({ error: "Missing entityType or syncId" });
    }

    try {
      const { table, shouldSync } = entityConfig(entityType);
      const context = createCurrentRepositoryContext();
      const locateRow = locateSyncRow(entityType, userId, syncId);

      const [target] = (await context.drizzle
        .select()
        .from(table as typeof hosts)
        .where(locateRow)
        .limit(1)) as Record<string, unknown>[];
      if (target && !shouldSync(target)) {
        return res.status(400).json({ error: "This row is not synced" });
      }

      await context.drizzle.delete(table as typeof hosts).where(locateRow);

      await createCurrentSyncTombstoneRepository().record(
        userId,
        entityType,
        syncId,
      );
      await DatabaseSaveTrigger.forceSave("sync_tombstone_applied");

      res.json({ success: true });
    } catch (err) {
      databaseLogger.error("Failed to apply sync tombstone", err, {
        operation: "sync_tombstone_apply",
        entityType,
        userId,
      });
      res.status(500).json({ error: "Failed to apply deletion" });
    }
  },
);

/**
 * @openapi
 * /sync/{entityType}:
 *   post:
 *     summary: Upsert a synced row by syncId
 *     description: Creates or updates a row by its syncId. Used by the desktop app's remote sync engine to push local-only or newer rows to the other side of a sync pair.
 *     tags:
 *       - Sync
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Row upserted.
 *       400:
 *         description: Unknown entity type or missing syncId.
 *       500:
 *         description: Failed to upsert row.
 */
router.post(
  "/:entityType",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const entityType = req.params.entityType;
    if (!isValidEntityType(entityType)) {
      return res.status(400).json({ error: "Unknown entity type" });
    }
    const payload = req.body?.row;
    const syncId = payload?.syncId;
    if (!payload || typeof syncId !== "string" || !syncId) {
      return res.status(400).json({ error: "Missing row.syncId" });
    }

    try {
      // singleton is still needed below: those tables have no sync_id column
      // for the insert to populate.
      const { table, singleton, shouldSync } = entityConfig(entityType);
      const context = createCurrentRepositoryContext();

      const locateRow = locateSyncRow(entityType, userId, syncId);
      if (!shouldSync(payload)) {
        return res.status(400).json({ error: "This row is not synced" });
      }

      const existingRows = await context.drizzle
        .select()
        .from(table as typeof hosts)
        .where(locateRow)
        .limit(1);
      const existing = existingRows[0] as Record<string, unknown> | undefined;
      if (existing && !shouldSync(existing)) {
        return res.status(400).json({ error: "This row is not synced" });
      }

      const resolvedPayload = await deserializeSyncReferences(
        entityType,
        payload,
        (referenceType, referenceSyncId) =>
          findReferenceId(context, referenceType, referenceSyncId, userId),
      );
      if (
        entityType === "hosts" &&
        typeof resolvedPayload.parentHostId === "number"
      ) {
        const parentError = await validateParentHostId(
          userId,
          typeof existing?.id === "number" ? existing.id : null,
          resolvedPayload.parentHostId,
        );
        if (parentError) return res.status(400).json({ error: parentError });
      }
      const carriedPluginSettings = resolvedPayload.pluginSettings;
      delete resolvedPayload.pluginSettings;
      const writePayload = stripWritePayload(entityType, resolvedPayload);
      const encryptedPayload = encryptIfNeeded(
        entityType,
        writePayload,
        userId,
      );

      // Through the returning helpers, because MySQL has no RETURNING and a
      // bare .returning() throws there.
      let resultRow: Record<string, unknown>;
      if (existing) {
        const updatedRows = await updateReturning(
          context,
          table as typeof hosts,
          encryptedPayload,
          locateRow,
        );
        resultRow = updatedRows[0] as Record<string, unknown>;
      } else {
        const insertedRows = await insertReturningWhere(
          context,
          table as typeof hosts,
          (singleton
            ? { ...encryptedPayload, userId }
            : {
                ...encryptedPayload,
                userId,
                syncId,
              }) as typeof hosts.$inferInsert,
          locateRow,
        );
        resultRow = insertedRows[0] as Record<string, unknown>;
      }

      if (entityType === "hosts" && typeof resultRow?.id === "number") {
        await importHostPluginSettings(resultRow.id, carriedPluginSettings);
      }

      await DatabaseSaveTrigger.forceSave("sync_upsert");

      res.json({
        row: decryptIfNeeded(entityType, resultRow, userId),
        created: !existing,
      });
    } catch (err) {
      databaseLogger.error(`Failed to upsert sync row for ${entityType}`, err, {
        operation: "sync_upsert",
        entityType,
        userId,
      });
      res.status(500).json({ error: "Failed to upsert row" });
    }
  },
);

/**
 * @openapi
 * /sync/{entityType}/tombstones:
 *   get:
 *     summary: Pull deletion tombstones for an entity type
 *     description: Returns tombstones recorded since `since` so the other side of a sync pair can apply the same deletions.
 *     tags:
 *       - Sync
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tombstones recorded since the given timestamp.
 *       400:
 *         description: Unknown entity type.
 *       500:
 *         description: Failed to fetch tombstones.
 */
router.get(
  "/:entityType/tombstones",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const entityType = req.params.entityType;
    if (!isValidEntityType(entityType)) {
      return res.status(400).json({ error: "Unknown entity type" });
    }
    const since =
      typeof req.query.since === "string" && req.query.since
        ? req.query.since
        : null;

    try {
      const tombstones = await createCurrentSyncTombstoneRepository().listSince(
        userId,
        entityType,
        since,
      );
      res.json({ tombstones });
    } catch (err) {
      databaseLogger.error(
        `Failed to fetch sync tombstones for ${entityType}`,
        err,
        { operation: "sync_tombstones_pull", entityType, userId },
      );
      res.status(500).json({ error: "Failed to fetch tombstones" });
    }
  },
);

export default router;
