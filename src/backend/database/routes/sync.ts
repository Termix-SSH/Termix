import type { Request, Response } from "express";
import express from "express";
import { and, eq, gt } from "drizzle-orm";
import {
  hosts,
  sshCredentials,
  sshFolders,
  snippets,
  snippetFolders,
  vaultProfiles,
  dashboardServiceLinks,
  homepageItems,
} from "../db/schema.js";
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

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Encrypted tables need DataCrypto to translate between the wire payload
// (plaintext) and the stored row (encrypted). Everything else is stored
// and synced as-is.
const ENCRYPTED_ENTITY_TABLES: Partial<Record<SyncEntityType, string>> = {
  hosts: "ssh_data",
  sshCredentials: "ssh_credentials",
};

interface EntityConfig {
  table:
    | typeof hosts
    | typeof sshCredentials
    | typeof sshFolders
    | typeof snippets
    | typeof snippetFolders
    | typeof vaultProfiles
    | typeof dashboardServiceLinks
    | typeof homepageItems;
  // Fields that only make sense on the device that created the row, or
  // that are managed elsewhere and must never be overwritten by a sync
  // payload from the other side.
  readOnlyFields: string[];
}

const ENTITY_CONFIG: Record<SyncEntityType, EntityConfig> = {
  hosts: {
    table: hosts,
    readOnlyFields: ["connectionOrigin"],
  },
  sshCredentials: { table: sshCredentials, readOnlyFields: [] },
  sshFolders: { table: sshFolders, readOnlyFields: [] },
  snippets: { table: snippets, readOnlyFields: [] },
  snippetFolders: { table: snippetFolders, readOnlyFields: [] },
  vaultProfiles: { table: vaultProfiles, readOnlyFields: [] },
  dashboardServiceLinks: { table: dashboardServiceLinks, readOnlyFields: [] },
  homepageItems: { table: homepageItems, readOnlyFields: [] },
};

const VALID_ENTITY_TYPES = new Set(Object.keys(ENTITY_CONFIG));

export function isValidEntityType(value: unknown): value is SyncEntityType {
  return typeof value === "string" && VALID_ENTITY_TYPES.has(value);
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
  const { readOnlyFields } = ENTITY_CONFIG[entityType];
  const clean = { ...payload };
  delete clean.id;
  delete clean.userId;
  delete clean.syncId;
  for (const field of readOnlyFields) delete clean[field];
  return clean;
}

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
      const { table } = ENTITY_CONFIG[entityType];
      const context = createCurrentRepositoryContext();
      const conditions = [eq(table.userId, userId)];
      if (since && "updatedAt" in table) {
        conditions.push(gt((table as typeof hosts).updatedAt, since));
      }

      const rows = await context.drizzle
        .select()
        .from(table as typeof hosts)
        .where(and(...conditions));

      const decrypted = rows.map((row) =>
        decryptIfNeeded(entityType, row as Record<string, unknown>, userId),
      );

      res.json({ rows: decrypted });
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
      const { table } = ENTITY_CONFIG[entityType];
      const context = createCurrentRepositoryContext();

      const existingRows = await context.drizzle
        .select()
        .from(table as typeof hosts)
        .where(
          and(
            eq((table as typeof hosts).syncId, syncId),
            eq(table.userId, userId),
          ),
        )
        .limit(1);
      const existing = existingRows[0] as Record<string, unknown> | undefined;

      const writePayload = stripWritePayload(entityType, payload);
      const encryptedPayload = encryptIfNeeded(
        entityType,
        writePayload,
        userId,
      );

      let resultRow: Record<string, unknown>;
      if (existing) {
        const updatedRows = await context.drizzle
          .update(table as typeof hosts)
          .set(encryptedPayload)
          .where(
            and(
              eq((table as typeof hosts).id, existing.id as number),
              eq(table.userId, userId),
            ),
          )
          .returning();
        resultRow = updatedRows[0] as Record<string, unknown>;
      } else {
        const insertedRows = await context.drizzle
          .insert(table as typeof hosts)
          .values({
            ...encryptedPayload,
            userId,
            syncId,
          } as typeof hosts.$inferInsert)
          .returning();
        resultRow = insertedRows[0] as Record<string, unknown>;
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
      const { table } = ENTITY_CONFIG[entityType];
      const context = createCurrentRepositoryContext();

      await context.drizzle
        .delete(table as typeof hosts)
        .where(
          and(
            eq((table as typeof hosts).syncId, syncId),
            eq(table.userId, userId),
          ),
        );

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

export default router;
