import type { Request, RequestHandler, Response, Router } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { databaseLogger, sshLogger } from "../../utils/logger.js";
import {
  createCurrentCommandHistoryRepository,
  createCurrentFileManagerBookmarkRepository,
  createCurrentHostFolderRepository,
  createCurrentRecentActivityRepository,
  createCurrentRbacAccessRepository,
  createCurrentSshCredentialUsageRepository,
  createCurrentSessionRecordingRepository,
  createCurrentTransferRecentRepository,
} from "../repositories/factory.js";
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
        const { updatedHosts, updatedCredentials } =
          await createCurrentHostFolderRepository().renameFolder(
            userId,
            oldName,
            newName,
          );

        res.json({
          message: "Folder renamed successfully",
          updatedHosts,
          updatedCredentials,
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
        const folders =
          await createCurrentHostFolderRepository().listFolders(userId);

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
        const { folder, created } =
          await createCurrentHostFolderRepository().upsertMetadata(
            userId,
            name,
            color,
            icon,
          );

        if (!created) {
          databaseLogger.info("Updating SSH folder", {
            operation: "folder_update",
            userId,
            folderId: folder.id,
          });
        } else {
          databaseLogger.info("Creating SSH folder", {
            operation: "folder_create",
            userId,
            name,
          });
        }

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
        const hostFolderRepository = createCurrentHostFolderRepository();
        const hostsToDelete = await hostFolderRepository.listHostsInFolder(
          userId,
          folderName,
        );

        const hostIds = hostsToDelete.map((host) => host.id);

        if (hostIds.length > 0) {
          await createCurrentFileManagerBookmarkRepository().deleteByHostIds(
            hostIds,
          );

          await createCurrentTransferRecentRepository().deleteByHostIds(
            hostIds,
          );

          await createCurrentCommandHistoryRepository().deleteByHostIds(
            hostIds,
          );

          await createCurrentSshCredentialUsageRepository().deleteByHostIds(
            hostIds,
          );

          await createCurrentRecentActivityRepository().deleteByHostIds(
            hostIds,
          );

          await createCurrentRbacAccessRepository().deleteHostAccessForHosts(
            hostIds,
          );

          await createCurrentSessionRecordingRepository().deleteByHostIds(
            hostIds,
          );
        }

        await hostFolderRepository.deleteHostsAndFolderRecords(
          userId,
          folderName,
        );

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
