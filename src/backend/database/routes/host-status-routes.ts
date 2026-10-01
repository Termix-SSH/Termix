import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { sshLogger } from "../../utils/logger.js";
import { createCurrentSettingsRepository } from "../repositories/factory.js";
import {
  DEFAULT_STATUS_INTERVAL,
  GLOBAL_STATUS_INTERVAL_KEY,
  hostStatusService,
  type HostStatusEntry,
} from "../../hosts/status/host-status-service.js";

interface HostStatusRoutesDeps {
  authenticateJWT: RequestHandler;
  requireAdmin: RequestHandler;
}

/** "1,2,3" to a set of ids; undefined means the caller asked for all. */
export function parseStatusHostIds(value: unknown): Set<number> | null {
  if (value === undefined) return null;
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(",")
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  );
}

function sessionExpired(res: Response): Response {
  return res.status(401).json({
    error: "Session expired - please log in again",
    code: "SESSION_EXPIRED",
  });
}

export function registerHostStatusRoutes(
  router: Router,
  { authenticateJWT, requireAdmin }: HostStatusRoutesDeps,
): void {
  const permissionManager = PermissionManager.getInstance();

  /**
   * @openapi
   * /host/status:
   *   get:
   *     summary: Get host statuses
   *     description: Returns the online, reachable or offline status of every host the user can see. Starts status checks for the user's own hosts on first call.
   *     tags:
   *       - SSH
   *     parameters:
   *       - in: query
   *         name: hostIds
   *         required: false
   *         schema:
   *           type: string
   *         description: Comma separated ids. Only these of the user's own hosts are checked.
   *     responses:
   *       200:
   *         description: A map of host ids to status entries.
   *       401:
   *         description: Session expired - please log in again.
   */
  router.get(
    "/status",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      if (DataCrypto.getUserDataKey(userId) === null)
        return sessionExpired(res);

      const requested = parseStatusHostIds(req.query.hostIds);
      const statuses = await hostStatusService.statusesFor(userId, requested);

      // One batched permission check: this is polled every few seconds, and a
      // per-host check made it linear in host count against the database.
      const entries = [...statuses.entries()];
      const allowed = await permissionManager.filterAccessibleHostIds(
        userId,
        entries.map(([id]) => id),
      );

      const result: Record<number, HostStatusEntry> = {};
      for (const [id, entry] of entries) {
        if (allowed.has(id) && (requested === null || requested.has(id))) {
          result[id] = entry;
        }
      }
      res.json(result);
    },
  );

  /**
   * @openapi
   * /host/status/settings:
   *   get:
   *     summary: Get status check settings
   *     description: Returns the default number of seconds between status checks.
   *     tags:
   *       - SSH
   *     responses:
   *       200:
   *         description: The status check settings.
   *       403:
   *         description: Admin access required.
   */
  router.get(
    "/status/settings",
    authenticateJWT,
    requireAdmin,
    async (_req: Request, res: Response) => {
      const value = Number(
        await createCurrentSettingsRepository().get(GLOBAL_STATUS_INTERVAL_KEY),
      );
      res.json({
        statusCheckInterval:
          Number.isInteger(value) && value >= 5
            ? value
            : DEFAULT_STATUS_INTERVAL,
      });
    },
  );

  /**
   * @openapi
   * /host/status/settings:
   *   put:
   *     summary: Update status check settings
   *     description: Sets the default number of seconds between status checks and re-times every running check.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               statusCheckInterval:
   *                 type: integer
   *                 minimum: 5
   *                 maximum: 3600
   *     responses:
   *       200:
   *         description: Settings saved.
   *       400:
   *         description: Invalid interval.
   *       403:
   *         description: Admin access required.
   */
  router.put(
    "/status/settings",
    authenticateJWT,
    requireAdmin,
    async (req: Request, res: Response) => {
      const seconds = Number(req.body?.statusCheckInterval);
      if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) {
        return res
          .status(400)
          .json({ error: "Status check interval must be 5 to 3600 seconds" });
      }
      try {
        await createCurrentSettingsRepository().set(
          GLOBAL_STATUS_INTERVAL_KEY,
          String(seconds),
        );
        hostStatusService.retimeAll();
        res.json({ statusCheckInterval: seconds });
      } catch (error) {
        sshLogger.error("Failed to save status check settings", error, {
          operation: "host_status_settings",
        });
        res.status(500).json({ error: "Failed to save settings" });
      }
    },
  );

  /**
   * @openapi
   * /host/status/refresh:
   *   post:
   *     summary: Restart status checks
   *     description: Re-reads the user's own hosts and restarts their status checks.
   *     tags:
   *       - SSH
   *     responses:
   *       200:
   *         description: Status checks restarted.
   *       401:
   *         description: Session expired - please log in again.
   */
  router.post(
    "/status/refresh",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      if (DataCrypto.getUserDataKey(userId) === null) {
        return sessionExpired(res);
      }
      await hostStatusService.refresh(userId);
      res.json({ message: "Status checks restarted" });
    },
  );

  /**
   * @openapi
   * /host/status/{id}:
   *   get:
   *     summary: Get one host's status
   *     description: Returns the status of one host the user can connect to.
   *     tags:
   *       - SSH
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The host's status entry.
   *       400:
   *         description: Invalid host id.
   *       404:
   *         description: Status not available.
   */
  router.get(
    "/status/:id",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid host ID" });
      }
      const userId = (req as AuthenticatedRequest).userId;
      if (DataCrypto.getUserDataKey(userId) === null) {
        return sessionExpired(res);
      }

      const access = await permissionManager.canAccessHost(
        userId,
        id,
        "connect",
      );
      if (!access.hasAccess) {
        return res.status(404).json({ error: "Status not available" });
      }

      await hostStatusService.statusesFor(userId, null);
      const entry =
        hostStatusService.get(id) ?? (await hostStatusService.check(id));
      if (!entry) {
        return res.status(404).json({ error: "Status not available" });
      }
      res.json(entry);
    },
  );
}
