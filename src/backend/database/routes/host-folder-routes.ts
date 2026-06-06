import type { Request, RequestHandler, Response, Router } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { databaseLogger, sshLogger } from "../../utils/logger.js";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  commandHistory,
  fileManagerPinned,
  fileManagerRecent,
  fileManagerShortcuts,
  hostAccess,
  hosts,
  recentActivity,
  sessionRecordings,
  sshCredentialUsage,
  sshCredentials,
  sshFolders,
  transferRecent,
} from "../db/schema.js";
import { isNonEmptyString } from "./host-normalizers.js";

type HostFolderRoutesDeps = {
  authenticateJWT: RequestHandler;
  statsServerUrl: string;
};

export function registerHostFolderRoutes(
  router: Router,
  { authenticateJWT, statsServerUrl }: HostFolderRoutesDeps,
): void {
  /**
   * @openapi
   * /host/folders/rename:
   *   put:
   *     summary: Rename folder
   *     description: Renames a folder for SSH hosts and credentials.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               oldName:
   *                 type: string
   *               newName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Folder renamed successfully.
   *       400:
   *         description: Old name and new name are required.
   *       500:
   *         description: Failed to rename folder.
   */
  router.put(
    "/folders/rename",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { oldName, newName } = req.body;

      if (!isNonEmptyString(userId) || !oldName || !newName) {
        sshLogger.warn("Invalid data for folder rename");
        return res
          .status(400)
          .json({ error: "Old name and new name are required" });
      }

      if (oldName === newName) {
        return res.json({ message: "Folder name unchanged" });
      }

      try {
        const now = new Date().toISOString();
        const oldPrefix = `${oldName} / `;
        const newPrefix = `${newName} / `;
        const childLike = `${oldPrefix}%`;

        // folder is a plaintext column, so a SQL expression renames the exact
        // folder and re-paths every nested child in one statement.
        const renameExpr = (col: SQLiteColumn) =>
          sql`CASE WHEN ${col} = ${oldName} THEN ${newName} ELSE ${newPrefix} || substr(${col}, ${oldPrefix.length + 1}) END`;

        const folderMatch = (col: SQLiteColumn) =>
          or(eq(col, oldName), like(col, childLike));

        const updatedHosts = await db
          .update(hosts)
          .set({ folder: renameExpr(hosts.folder), updatedAt: now })
          .where(and(eq(hosts.userId, userId), folderMatch(hosts.folder)))
          .returning();

        const updatedCredentials = await db
          .update(sshCredentials)
          .set({ folder: renameExpr(sshCredentials.folder), updatedAt: now })
          .where(
            and(
              eq(sshCredentials.userId, userId),
              folderMatch(sshCredentials.folder),
            ),
          )
          .returning();

        DatabaseSaveTrigger.triggerSave("folder_rename");

        await db
          .update(sshFolders)
          .set({ name: renameExpr(sshFolders.name), updatedAt: now })
          .where(
            and(eq(sshFolders.userId, userId), folderMatch(sshFolders.name)),
          );

        res.json({
          message: "Folder renamed successfully",
          updatedHosts: updatedHosts.length,
          updatedCredentials: updatedCredentials.length,
        });
      } catch (err) {
        sshLogger.error("Failed to rename folder", err, {
          operation: "folder_rename",
          userId,
          oldName,
          newName,
        });
        res.status(500).json({ error: "Failed to rename folder" });
      }
    },
  );

  /**
   * @openapi
   * /host/folders:
   *   get:
   *     summary: Get all folders
   *     description: Retrieves all folders for the authenticated user.
   *     tags:
   *       - SSH
   *     responses:
   *       200:
   *         description: A list of folders.
   *       400:
   *         description: Invalid user ID.
   *       500:
   *         description: Failed to fetch folders.
   */
  router.get(
    "/folders",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;

      if (!isNonEmptyString(userId)) {
        return res.status(400).json({ error: "Invalid user ID" });
      }

      try {
        const folders = await db
          .select()
          .from(sshFolders)
          .where(eq(sshFolders.userId, userId));

        res.json(folders);
      } catch (err) {
        sshLogger.error("Failed to fetch folders", err, {
          operation: "fetch_folders",
          userId,
        });
        res.status(500).json({ error: "Failed to fetch folders" });
      }
    },
  );

  /**
   * @openapi
   * /host/folders/metadata:
   *   put:
   *     summary: Update folder metadata
   *     description: Updates the metadata (color, icon) of a folder.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               color:
   *                 type: string
   *               icon:
   *                 type: string
   *     responses:
   *       200:
   *         description: Folder metadata updated successfully.
   *       400:
   *         description: Folder name is required.
   *       500:
   *         description: Failed to update folder metadata.
   */
  router.put(
    "/folders/metadata",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { name, color, icon } = req.body;

      if (!isNonEmptyString(userId) || !name) {
        return res.status(400).json({ error: "Folder name is required" });
      }

      try {
        const existing = await db
          .select()
          .from(sshFolders)
          .where(and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)))
          .limit(1);

        if (existing.length > 0) {
          databaseLogger.info("Updating SSH folder", {
            operation: "folder_update",
            userId,
            folderId: existing[0].id,
          });
          await db
            .update(sshFolders)
            .set({
              color,
              icon,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)),
            );
        } else {
          databaseLogger.info("Creating SSH folder", {
            operation: "folder_create",
            userId,
            name,
          });
          await db.insert(sshFolders).values({
            userId,
            name,
            color,
            icon,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        DatabaseSaveTrigger.triggerSave("folder_metadata_update");

        res.json({ message: "Folder metadata updated successfully" });
      } catch (err) {
        sshLogger.error("Failed to update folder metadata", err, {
          operation: "update_folder_metadata",
          userId,
          name,
        });
        res.status(500).json({ error: "Failed to update folder metadata" });
      }
    },
  );

  /**
   * @openapi
   * /host/folders/{name}/hosts:
   *   delete:
   *     summary: Delete all hosts in folder
   *     description: Deletes all SSH hosts within a specific folder.
   *     tags:
   *       - SSH
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Hosts deleted successfully.
   *       400:
   *         description: Invalid folder name.
   *       500:
   *         description: Failed to delete hosts in folder.
   */
  router.delete(
    "/folders/:name/hosts",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const folderName = Array.isArray(req.params.name)
        ? req.params.name[0]
        : req.params.name;

      if (!isNonEmptyString(userId) || !folderName) {
        return res.status(400).json({ error: "Invalid folder name" });
      }
      databaseLogger.info("Deleting SSH folder", {
        operation: "folder_delete",
        userId,
        folderId: folderName,
      });

      try {
        // Match the folder itself and any nested children (e.g. "fgh / sub").
        const childLike = `${folderName} / %`;
        const folderMatch = (col: SQLiteColumn) =>
          or(eq(col, folderName), like(col, childLike));

        const hostsToDelete = await db
          .select()
          .from(hosts)
          .where(and(eq(hosts.userId, userId), folderMatch(hosts.folder)));

        const hostIds = hostsToDelete.map((host) => host.id);

        if (hostIds.length > 0) {
          await db
            .delete(fileManagerRecent)
            .where(inArray(fileManagerRecent.hostId, hostIds));

          await db
            .delete(fileManagerPinned)
            .where(inArray(fileManagerPinned.hostId, hostIds));

          await db
            .delete(fileManagerShortcuts)
            .where(inArray(fileManagerShortcuts.hostId, hostIds));

          await db
            .delete(transferRecent)
            .where(
              or(
                inArray(transferRecent.sourceHostId, hostIds),
                inArray(transferRecent.destHostId, hostIds),
              ),
            );

          await db
            .delete(commandHistory)
            .where(inArray(commandHistory.hostId, hostIds));

          await db
            .delete(sshCredentialUsage)
            .where(inArray(sshCredentialUsage.hostId, hostIds));

          await db
            .delete(recentActivity)
            .where(inArray(recentActivity.hostId, hostIds));

          await db
            .delete(hostAccess)
            .where(inArray(hostAccess.hostId, hostIds));

          await db
            .delete(sessionRecordings)
            .where(inArray(sessionRecordings.hostId, hostIds));
        }

        if (hostIds.length > 0) {
          await db
            .delete(hosts)
            .where(and(eq(hosts.userId, userId), folderMatch(hosts.folder)));
        }

        // Always remove the folder records (and nested children), even when the
        // folder held no hosts, so empty folders don't reappear on reload.
        await db
          .delete(sshFolders)
          .where(
            and(eq(sshFolders.userId, userId), folderMatch(sshFolders.name)),
          );

        DatabaseSaveTrigger.triggerSave("folder_hosts_delete");

        try {
          const axios = (await import("axios")).default;
          for (const host of hostsToDelete) {
            try {
              await axios.post(
                `${statsServerUrl}/host-deleted`,
                { hostId: host.id },
                {
                  headers: {
                    Authorization: req.headers.authorization || "",
                    Cookie: req.headers.cookie || "",
                  },
                  timeout: 5000,
                },
              );
            } catch (err) {
              sshLogger.warn("Failed to notify stats server of host deletion", {
                operation: "folder_hosts_delete",
                hostId: host.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } catch (err) {
          sshLogger.warn("Failed to notify stats server of folder deletion", {
            operation: "folder_hosts_delete",
            folderName,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        res.json({
          message: "All hosts in folder deleted successfully",
          deletedCount: hostsToDelete.length,
        });
      } catch (err) {
        sshLogger.error("Failed to delete hosts in folder", err, {
          operation: "delete_folder_hosts",
          userId,
          folderName,
        });
        res.status(500).json({ error: "Failed to delete hosts in folder" });
      }
    },
  );
}
