/**
 * Device logins for shared hosts and folders on a linked desktop. Only the
 * desktop's own backend serves these, and the secret never leaves it.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Router } from "express";
import { and, eq } from "drizzle-orm";
import { hosts } from "../db/schema.js";
import {
  createCurrentRepositoryContext,
  createCurrentSharedFolderAuthOverrideRepository,
  createCurrentSharedHostAuthOverrideRepository,
} from "../repositories/factory.js";
import { folderAndParents } from "../repositories/shared-folder-auth-override-repository.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { AuthOverrideProtocol } from "../../../types/auth-protocols.js";
import { isAuthOverrideProtocol } from "../../hosts/protocol-auth/registry.js";
import {
  connectFromDevice,
  deviceLoginsAvailable,
  listDeviceCredentials,
} from "../../hosts/device-auth.js";
import { sshLogger } from "../../utils/logger.js";

function onDesktop(_req: Request, res: Response, next: NextFunction): void {
  if (deviceLoginsAvailable()) return next();
  res.status(404).json({ error: "Device logins are only on the desktop app" });
}

function protocolOf(req: Request): AuthOverrideProtocol | null {
  const protocol = String(req.params.protocol);
  return isAuthOverrideProtocol(protocol) ? protocol : null;
}

async function sharedCopy(
  hostId: number,
  userId: string,
): Promise<{ id: number } | null> {
  const [row] = await createCurrentRepositoryContext()
    .drizzle.select({ id: hosts.id, sharedSource: hosts.sharedSource })
    .from(hosts)
    .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
    .limit(1);
  return row?.sharedSource ? { id: row.id } : null;
}

async function ownDeviceCredential(
  credentialId: unknown,
  userId: string,
): Promise<number | null> {
  const id = Number(credentialId);
  const owned = await listDeviceCredentials(userId);
  return owned.some((credential) => credential.id === id) ? id : null;
}

function fail(res: Response, error: unknown): void {
  sshLogger.error("Device login request failed", error, {
    operation: "device_auth",
  });
  res.status(500).json({ error: "Failed to save the device login" });
}

export function registerDeviceAuthRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
  requireViewPermission: RequestHandler,
): void {
  /**
   * @openapi
   * /host/db/host/{id}/device-auth/{protocol}:
   *   get:
   *     summary: Get a shared host's device login
   *     description: Desktop only. The device login for a shared host's copy and the device only credentials to pick from.
   *     tags:
   *       - SSH
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: protocol
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: "{ credentialId, credentials }"
   *       404:
   *         description: Not a shared copy, or not on the desktop.
   *   put:
   *     summary: Set a shared host's device login
   *     description: Desktop only. The credential must be kept on this device. Connections to the host then start from the device. A null credentialId clears it.
   *     tags:
   *       - SSH
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: protocol
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               credentialId:
   *                 type: integer
   *                 nullable: true
   *     responses:
   *       200:
   *         description: Saved.
   *       400:
   *         description: Not a device only credential.
   *       404:
   *         description: Not a shared copy, or not on the desktop.
   */
  router.get(
    "/db/host/:id/device-auth/:protocol",
    authenticateJWT,
    requireViewPermission,
    onDesktop,
    async (req, res) => {
      try {
        const { userId } = req as AuthenticatedRequest;
        const protocol = protocolOf(req);
        const host = await sharedCopy(Number(req.params.id), userId);
        if (!protocol || !host) {
          return res.status(404).json({ error: "Host not found" });
        }
        res.json({
          credentialId:
            await createCurrentSharedHostAuthOverrideRepository().findCredentialId(
              host.id,
              userId,
              protocol,
            ),
          credentials: await listDeviceCredentials(userId),
        });
      } catch (error) {
        fail(res, error);
      }
    },
  );

  router.put(
    "/db/host/:id/device-auth/:protocol",
    authenticateJWT,
    onDesktop,
    async (req, res) => {
      try {
        const { userId } = req as AuthenticatedRequest;
        const protocol = protocolOf(req);
        const host = await sharedCopy(Number(req.params.id), userId);
        if (!protocol || !host) {
          return res.status(404).json({ error: "Host not found" });
        }
        const overrides = createCurrentSharedHostAuthOverrideRepository();
        if (req.body?.credentialId == null) {
          await overrides.clearCredential(host.id, userId, protocol);
          return res.json({ credentialId: null });
        }
        const id = await ownDeviceCredential(req.body.credentialId, userId);
        if (!id) {
          return res
            .status(400)
            .json({ error: "Not a device only credential" });
        }
        await overrides.setCredential(host.id, userId, protocol, id);
        await connectFromDevice(userId, (row) => row.id === host.id);
        res.json({ credentialId: id });
      } catch (error) {
        fail(res, error);
      }
    },
  );

  /**
   * @openapi
   * /host/device-auth/folder/{protocol}:
   *   get:
   *     summary: Get a shared folder's device login
   *     description: Desktop only. The device login for a folder of shared hosts and its subfolders.
   *     tags:
   *       - SSH
   *     parameters:
   *       - in: path
   *         name: protocol
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: folder
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: "{ credentialId, credentials }"
   *   put:
   *     summary: Set a shared folder's device login
   *     description: Desktop only. The credential must be kept on this device. Connections to the shared hosts in the folder then start from the device. A null credentialId clears it.
   *     tags:
   *       - SSH
   *     parameters:
   *       - in: path
   *         name: protocol
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               folder:
   *                 type: string
   *               credentialId:
   *                 type: integer
   *                 nullable: true
   *     responses:
   *       200:
   *         description: Saved.
   *       400:
   *         description: No folder, or not a device only credential.
   */
  router.get(
    "/device-auth/folder/:protocol",
    authenticateJWT,
    onDesktop,
    async (req, res) => {
      try {
        const { userId } = req as AuthenticatedRequest;
        const protocol = protocolOf(req);
        const folder = String(req.query.folder ?? "").trim();
        if (!protocol || !folder) {
          return res.status(400).json({ error: "Folder is required" });
        }
        res.json({
          credentialId:
            await createCurrentSharedFolderAuthOverrideRepository().findCredentialId(
              userId,
              folder,
              protocol,
            ),
          credentials: await listDeviceCredentials(userId),
        });
      } catch (error) {
        fail(res, error);
      }
    },
  );

  router.put(
    "/device-auth/folder/:protocol",
    authenticateJWT,
    onDesktop,
    async (req, res) => {
      try {
        const { userId } = req as AuthenticatedRequest;
        const protocol = protocolOf(req);
        const folder = String(req.body?.folder ?? "").trim();
        if (!protocol || !folder) {
          return res.status(400).json({ error: "Folder is required" });
        }
        const overrides = createCurrentSharedFolderAuthOverrideRepository();
        if (req.body?.credentialId == null) {
          await overrides.clearCredential(userId, folder, protocol);
          return res.json({ credentialId: null });
        }
        const id = await ownDeviceCredential(req.body.credentialId, userId);
        if (!id) {
          return res
            .status(400)
            .json({ error: "Not a device only credential" });
        }
        await overrides.setCredential(userId, folder, protocol, id);
        await connectFromDevice(userId, (row) =>
          folderAndParents(row.folder).includes(folder),
        );
        res.json({ credentialId: id });
      } catch (error) {
        fail(res, error);
      }
    },
  );
}
