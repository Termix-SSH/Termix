import type { Request, RequestHandler, Response, Router } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { databaseLogger } from "../../utils/logger.js";
import {
  getRequestMeta,
  logAudit,
  getAuditUsername,
} from "../../utils/audit-logger.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { createCurrentHostDefaultsRepository } from "../repositories/factory.js";
import type { HostDefaultsScope } from "../repositories/host-defaults-repository.js";
import { findUsableCredential } from "../../hosts/usable-credential.js";
import {
  currentCatalog,
  materializeHosts,
} from "../../hosts/defaults/materialize.js";
import {
  getRecomputeJob,
  recompute,
  startRecomputeJob,
  targetForScope,
} from "../../hosts/defaults/recompute.js";
import {
  levelsAbove,
  readLevel,
  resolveAll,
  resolveForEditor,
  saveLevel,
  validateLevelChange,
  type CheckContext,
  type LevelChangeInput,
} from "../../hosts/defaults/service.js";
import { changeHostOverrides } from "../../hosts/defaults/overrides.js";
import { readDefaultsReset } from "./host-bulk-routes.js";

type HostDefaultsRoutesDeps = {
  authenticateJWT: RequestHandler;
  requireEditPermission: RequestHandler;
  requireDataAccess: RequestHandler;
  requireAdminSettings: RequestHandler;
};

function checkContext(actorId: string, ownerId: string | null): CheckContext {
  const permissions = PermissionManager.getInstance();
  return {
    actorId,
    ownerId,
    canUseCredential: async (credentialId, userId) =>
      (await findUsableCredential(credentialId, userId)) !== null,
    canUseHost: async (hostId, userId) =>
      (await permissions.canAccessHost(userId, hostId, "connect")).hasAccess,
  };
}

function readChange(body: unknown): LevelChangeInput {
  const source =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    set:
      source.set && typeof source.set === "object" && !Array.isArray(source.set)
        ? (source.set as Record<string, unknown>)
        : {},
    unset: Array.isArray(source.unset)
      ? source.unset.filter((key): key is string => typeof key === "string")
      : [],
  };
}

async function describeLevel(
  scope: HostDefaultsScope,
  folderOwner?: { userId: string; name: string },
) {
  const { catalog } = currentCatalog();
  return {
    values: await readLevel(scope),
    inherited: resolveAll(catalog, await levelsAbove(scope, folderOwner)),
  };
}

/** The folder a user may edit defaults for, by id. */
async function ownedFolder(userId: string, folderId: number) {
  const folder =
    await createCurrentHostDefaultsRepository().findFolder(folderId);
  return folder && folder.userId === userId ? folder : null;
}

export function registerHostDefaultsRoutes(
  router: Router,
  {
    authenticateJWT,
    requireEditPermission,
    requireDataAccess,
    requireAdminSettings,
  }: HostDefaultsRoutesDeps,
): void {
  const save = async (
    req: Request,
    res: Response,
    scope: HostDefaultsScope,
    ownerId: string | null,
    folderOwnerId?: string,
  ) => {
    const actorId = (req as AuthenticatedRequest).userId;
    const change = await validateLevelChange(
      scope,
      readChange(req.body),
      checkContext(actorId, ownerId),
    );
    if (Object.keys(change.errors).length > 0) {
      return res
        .status(400)
        .json({ error: "Some defaults were rejected", errors: change.errors });
    }
    await saveLevel(scope, change, actorId);
    const keys = new Set([...change.set.keys(), ...change.unset]);

    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId: actorId,
      username: await getAuditUsername(actorId),
      action: "update_host_defaults",
      resourceType: "host_defaults",
      resourceId:
        scope.level === "admin"
          ? "admin"
          : scope.level === "user"
            ? String(scope.userId)
            : String(scope.folderId),
      resourceName: scope.level,
      details: JSON.stringify({ keys: [...keys] }),
      ipAddress,
      userAgent,
      success: true,
    });

    const target = targetForScope(scope, folderOwnerId);
    if (scope.level === "admin") {
      const job = startRecomputeJob(target, keys);
      return res.json({ jobId: job.id });
    }
    const result = await recompute(target, keys);
    return res.json({ changedHosts: result.changedHostIds.length });
  };

  /**
   * @openapi
   * /host/defaults/admin:
   *   get:
   *     summary: Get the server's host defaults
   *     description: The host defaults every user's hosts follow unless the user, a folder or the host sets its own. Returns the values set at this level and what each key reads without them.
   *     tags:
   *       - Host Defaults
   *     responses:
   *       200:
   *         description: Values and inherited values, keyed by "namespace.key".
   *       403:
   *         description: Missing admin.settings.manage.
   */
  router.get(
    "/defaults/admin",
    authenticateJWT,
    requireAdminSettings,
    async (_req: Request, res: Response) => {
      try {
        res.json(await describeLevel({ level: "admin" }));
      } catch (error) {
        databaseLogger.error("Failed to read admin host defaults", error);
        res.status(500).json({ error: "Failed to read host defaults" });
      }
    },
  );

  /**
   * @openapi
   * /host/defaults/admin:
   *   put:
   *     summary: Update the server's host defaults
   *     description: Sets and clears server-wide host defaults. Every inheriting host is updated in the background; poll the returned job.
   *     tags:
   *       - Host Defaults
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               set:
   *                 type: object
   *                 description: Values by "namespace.key".
   *               unset:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Saved. Returns the recompute job id.
   *       400:
   *         description: One or more values were rejected.
   *       403:
   *         description: Missing admin.settings.manage.
   */
  router.put(
    "/defaults/admin",
    authenticateJWT,
    requireAdminSettings,
    async (req: Request, res: Response) => {
      try {
        await save(req, res, { level: "admin" }, null);
      } catch (error) {
        databaseLogger.error("Failed to update admin host defaults", error);
        res.status(500).json({ error: "Failed to update host defaults" });
      }
    },
  );

  /**
   * @openapi
   * /host/defaults/user:
   *   get:
   *     summary: Get your host defaults
   *     description: The defaults your hosts follow, over the server's. Returns the values you set and what each key reads without them.
   *     tags:
   *       - Host Defaults
   *     responses:
   *       200:
   *         description: Values and inherited values, keyed by "namespace.key".
   */
  router.get(
    "/defaults/user",
    authenticateJWT,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      try {
        res.json(await describeLevel({ level: "user", userId }));
      } catch (error) {
        databaseLogger.error("Failed to read user host defaults", error);
        res.status(500).json({ error: "Failed to read host defaults" });
      }
    },
  );

  /**
   * @openapi
   * /host/defaults/user:
   *   put:
   *     summary: Update your host defaults
   *     description: Sets and clears your own host defaults and updates every host of yours that follows them.
   *     tags:
   *       - Host Defaults
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               set:
   *                 type: object
   *               unset:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Saved. Returns how many hosts changed.
   *       400:
   *         description: One or more values were rejected.
   */
  router.put(
    "/defaults/user",
    authenticateJWT,
    requireEditPermission,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      try {
        await save(req, res, { level: "user", userId }, userId);
      } catch (error) {
        databaseLogger.error("Failed to update user host defaults", error);
        res.status(500).json({ error: "Failed to update host defaults" });
      }
    },
  );

  /**
   * @openapi
   * /host/defaults/folders/{folderId}:
   *   get:
   *     summary: Get a folder's host defaults
   *     description: The defaults hosts in this folder and its subfolders follow, over yours and the server's.
   *     tags:
   *       - Host Defaults
   *     parameters:
   *       - in: path
   *         name: folderId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Values and inherited values, keyed by "namespace.key".
   *       404:
   *         description: No such folder of yours.
   */
  router.get(
    "/defaults/folders/:folderId",
    authenticateJWT,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const folder = await ownedFolder(userId, Number(req.params.folderId));
      if (!folder) return res.status(404).json({ error: "Folder not found" });
      try {
        res.json(
          await describeLevel(
            { level: "folder", folderId: folder.id, userId },
            folder,
          ),
        );
      } catch (error) {
        databaseLogger.error("Failed to read folder host defaults", error);
        res.status(500).json({ error: "Failed to read host defaults" });
      }
    },
  );

  /**
   * @openapi
   * /host/defaults/folders/{folderId}:
   *   put:
   *     summary: Update a folder's host defaults
   *     description: Sets and clears a folder's host defaults and updates every host in it (and its subfolders) that follows them.
   *     tags:
   *       - Host Defaults
   *     parameters:
   *       - in: path
   *         name: folderId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: Saved. Returns how many hosts changed.
   *       400:
   *         description: One or more values were rejected.
   *       404:
   *         description: No such folder of yours.
   */
  router.put(
    "/defaults/folders/:folderId",
    authenticateJWT,
    requireEditPermission,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const folder = await ownedFolder(userId, Number(req.params.folderId));
      if (!folder) return res.status(404).json({ error: "Folder not found" });
      try {
        await save(
          req,
          res,
          { level: "folder", folderId: folder.id, userId },
          userId,
          userId,
        );
      } catch (error) {
        databaseLogger.error("Failed to update folder host defaults", error);
        res.status(500).json({ error: "Failed to update host defaults" });
      }
    },
  );

  /**
   * @openapi
   * /host/defaults/folders:
   *   post:
   *     summary: Get or create a folder's defaults id
   *     description: A folder can exist only as a path on its hosts. This returns its id, creating the folder row when needed, so its defaults can be edited.
   *     tags:
   *       - Host Defaults
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *     responses:
   *       200:
   *         description: The folder's id.
   *       400:
   *         description: Missing folder name.
   */
  router.post(
    "/defaults/folders",
    authenticateJWT,
    requireEditPermission,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const name = typeof req.body?.name === "string" ? req.body.name : "";
      if (!name.trim()) {
        return res.status(400).json({ error: "Folder name is required" });
      }
      try {
        const id = await createCurrentHostDefaultsRepository().ensureFolder(
          userId,
          name,
        );
        res.json({ id });
      } catch (error) {
        databaseLogger.error("Failed to find folder for host defaults", error);
        res.status(500).json({ error: "Failed to find the folder" });
      }
    },
  );

  /**
   * @openapi
   * /host/defaults/preview:
   *   post:
   *     summary: Preview a host defaults change
   *     description: How many hosts would change if a level were saved with these values. Nothing is written.
   *     tags:
   *       - Host Defaults
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               level:
   *                 type: string
   *                 enum: [admin, user, folder]
   *               folderId:
   *                 type: integer
   *               set:
   *                 type: object
   *               unset:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: The number of hosts that would change.
   *       403:
   *         description: Not allowed to change that level.
   */
  router.post(
    "/defaults/preview",
    authenticateJWT,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const level = req.body?.level;
      try {
        let target;
        let overlayUserId: string | undefined;
        let folderId: number | undefined;
        if (level === "admin") {
          const permissions = PermissionManager.getInstance();
          if (
            !(await permissions.hasPermission(userId, "admin.settings.manage"))
          ) {
            return res.status(403).json({ error: "Access denied" });
          }
          target = { all: true };
        } else if (level === "user") {
          target = { userIds: [userId] };
          overlayUserId = userId;
        } else if (level === "folder") {
          const folder = await ownedFolder(userId, Number(req.body?.folderId));
          if (!folder)
            return res.status(404).json({ error: "Folder not found" });
          target = { userIds: [userId] };
          folderId = folder.id;
        } else {
          return res.status(400).json({ error: "Unknown level" });
        }
        const change = readChange(req.body);
        const { catalog } = currentCatalog();
        const set = new Map<string, unknown>();
        for (const [key, value] of Object.entries(change.set ?? {})) {
          const info = catalog.get(key);
          if (info) set.set(key, info.normalize(value));
        }
        const result = await materializeHosts(target, {
          dryRun: true,
          overlay: {
            level,
            userId: overlayUserId,
            folderId,
            set,
            unset: new Set(change.unset ?? []),
          },
        });
        res.json({ changedHosts: result.changedHostIds.length });
      } catch (error) {
        databaseLogger.error("Failed to preview host defaults", error);
        res.status(500).json({ error: "Failed to preview host defaults" });
      }
    },
  );

  /**
   * @openapi
   * /host/defaults/resolve:
   *   get:
   *     summary: Resolve host defaults for a host
   *     description: What every key resolves to for a host, or for a new host in a folder or under a parent host, and where each value comes from.
   *     tags:
   *       - Host Defaults
   *     parameters:
   *       - in: query
   *         name: hostId
   *         schema:
   *           type: integer
   *       - in: query
   *         name: folder
   *         schema:
   *           type: string
   *       - in: query
   *         name: parentHostId
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Resolved values with their source, keyed by "namespace.key".
   *       404:
   *         description: No such host you can edit.
   */
  router.get(
    "/defaults/resolve",
    authenticateJWT,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      try {
        let ownerId = userId;
        const hostId =
          req.query.hostId !== undefined ? Number(req.query.hostId) : null;
        if (hostId !== null) {
          if (!Number.isInteger(hostId)) {
            return res.status(400).json({ error: "Invalid host ID" });
          }
          const access = await PermissionManager.getInstance().canAccessHost(
            userId,
            hostId,
            "edit",
          );
          if (!access.hasAccess) {
            return res.status(404).json({ error: "Host not found" });
          }
          const [row] = await createCurrentHostDefaultsRepository().listHosts({
            hostIds: [hostId],
          });
          if (!row) return res.status(404).json({ error: "Host not found" });
          ownerId = row.userId;
        }
        const folder =
          typeof req.query.folder === "string" ? req.query.folder : undefined;
        const parentHostId =
          req.query.parentHostId !== undefined && req.query.parentHostId !== ""
            ? Number(req.query.parentHostId)
            : undefined;
        res.json({
          values: await resolveForEditor({
            ownerId,
            hostId,
            folder: folder === undefined ? undefined : folder || null,
            parentHostId:
              parentHostId === undefined || !Number.isInteger(parentHostId)
                ? folder !== undefined
                  ? null
                  : undefined
                : parentHostId,
          }),
        });
      } catch (error) {
        databaseLogger.error("Failed to resolve host defaults", error);
        res.status(500).json({ error: "Failed to resolve host defaults" });
      }
    },
  );

  /**
   * @openapi
   * /host/defaults/jobs/{id}:
   *   get:
   *     summary: Host defaults job status
   *     description: Progress of a server-wide host defaults update.
   *     tags:
   *       - Host Defaults
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The job's status and how many hosts changed.
   *       404:
   *         description: No such job.
   */
  router.get(
    "/defaults/jobs/:id",
    authenticateJWT,
    requireAdminSettings,
    (req: Request, res: Response) => {
      const job = getRecomputeJob(String(req.params.id));
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json(job);
    },
  );

  /**
   * @openapi
   * /host/db/host/{id}/reset-defaults:
   *   post:
   *     summary: Reset a host to its defaults
   *     description: Hands keys the host set itself back to its host defaults. `all`, or `namespaces` ("core" or a plugin id), or `keys` as "namespace.key".
   *     tags:
   *       - Host Defaults
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               all:
   *                 type: boolean
   *               namespaces:
   *                 type: array
   *                 items:
   *                   type: string
   *               keys:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: Reset.
   *       400:
   *         description: Nothing to reset.
   *       403:
   *         description: No edit access to the host.
   */
  router.post(
    "/db/host/:id/reset-defaults",
    authenticateJWT,
    requireEditPermission,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const hostId = Number(req.params.id);
      if (!Number.isInteger(hostId)) {
        return res.status(400).json({ error: "Invalid host ID" });
      }
      const reset = readDefaultsReset(req.body);
      if (!reset) return res.status(400).json({ error: "Nothing to reset" });
      try {
        const access = await PermissionManager.getInstance().canAccessHost(
          userId,
          hostId,
          "edit",
        );
        if (!access.hasAccess) {
          return res.status(403).json({ error: "Access denied" });
        }
        if (!access.isOwner) {
          // A shared editor never takes over the owner's SSH login.
          reset.inherit = (reset.inherit ?? []).filter(
            ([namespace, key]) => !(namespace === "core" && key === "auth"),
          );
          if (reset.inheritAll || reset.inheritNamespaces?.includes("core")) {
            return res.status(403).json({
              error: "Only the host owner can reset the host's SSH login",
            });
          }
        }
        await changeHostOverrides([hostId], reset);
        res.json({ message: "Host reset to its defaults" });
      } catch (error) {
        databaseLogger.error("Failed to reset host defaults", error);
        res.status(500).json({ error: "Failed to reset host defaults" });
      }
    },
  );
}
