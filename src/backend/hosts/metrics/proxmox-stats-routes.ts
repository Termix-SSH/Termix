import { getErrorMessage } from "../../utils/error-message.js";
import type { Express, RequestHandler } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { statsLogger } from "../../utils/logger.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import type { HostAction } from "../../utils/permission-manager.js";
import type { ProxmoxPollingManager } from "./proxmox-stats-polling.js";
import type { ProxmoxStatsPollableHost } from "./proxmox-stats-polling.js";

const EMPTY_SNAPSHOT = {
  node: {
    cpu: { percent: null, cores: null, load: null },
    memory: { percent: null, usedGiB: null, totalGiB: null },
    disk: { percent: null, usedGiB: null, totalGiB: null },
    uptime: { seconds: null, formatted: null },
    system: { hostname: null, kernel: null, pveVersion: null },
  },
  network: { interfaces: [] },
  guests: { guests: [], counts: { running: 0, stopped: 0, total: 0 } },
  storage: { pools: [] },
  cluster: { clustered: false },
  lastChecked: new Date(0).toISOString(),
};

type ProxmoxStatsHost = ProxmoxStatsPollableHost & {
  enableProxmoxStats?: boolean;
};

type ProxmoxStatsRoutesDeps = {
  validateHostId: RequestHandler;
  fetchHostById: (
    hostId: number,
    userId: string,
  ) => Promise<ProxmoxStatsHost | undefined>;
  canAccessHost: (
    userId: string,
    hostId: number,
    level: HostAction,
  ) => Promise<boolean>;
  pollingManager: ProxmoxPollingManager<ProxmoxStatsHost>;
};

export function registerProxmoxStatsRoutes(
  app: Express,
  {
    validateHostId,
    fetchHostById,
    canAccessHost,
    pollingManager,
  }: ProxmoxStatsRoutesDeps,
): void {
  /**
   * @openapi
   * /proxmox-stats/{id}:
   *   get:
   *     summary: Get cached Proxmox node stats for a host
   *     description: Returns the most recently polled Proxmox Stats snapshot for a host, or an empty skeleton if none has been collected yet.
   *     tags:
   *       - Proxmox Stats
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Proxmox stats snapshot.
   *       401:
   *         description: Session expired - please log in again.
   *       404:
   *         description: Stats not available yet.
   */
  app.get("/proxmox-stats/:id", validateHostId, async (req, res) => {
    const id = Number(req.params.id);
    const userId = (req as AuthenticatedRequest).userId;

    if (DataCrypto.getUserDataKey(userId) === null) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    const cached = pollingManager.getStats(id);
    if (!cached) {
      const errorState = pollingManager.getError(id);
      return res.status(404).json({
        error: errorState?.error || "Stats not available",
        ...EMPTY_SNAPSHOT,
        lastChecked: new Date().toISOString(),
      });
    }

    res.json({
      ...cached.data,
      lastChecked: new Date(cached.timestamp).toISOString(),
    });
  });

  /**
   * @openapi
   * /proxmox-stats/start/{id}:
   *   post:
   *     summary: Start Proxmox stats collection
   *     description: Registers a viewer and starts (or reuses) polling for a host's Proxmox node stats.
   *     tags:
   *       - Proxmox Stats
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Polling started, snapshot returned if already available.
   *       401:
   *         description: Session expired - please log in again.
   *       403:
   *         description: Proxmox Stats is not enabled for this host.
   *       404:
   *         description: Host not found.
   */
  app.post("/proxmox-stats/start/:id", validateHostId, async (req, res) => {
    const id = Number(req.params.id);
    const userId = (req as AuthenticatedRequest).userId;

    if (DataCrypto.getUserDataKey(userId) === null) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    try {
      if (!(await canAccessHost(userId, id, "connect"))) {
        return res.status(403).json({ error: "No access to this host" });
      }

      const host = await fetchHostById(id, userId);
      if (!host) {
        return res.status(404).json({ error: "Host not found" });
      }

      if (!host.enableProxmoxStats) {
        return res
          .status(403)
          .json({ error: "Proxmox Stats is not enabled for this host" });
      }

      const viewerSessionId = `proxmox-viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      pollingManager.registerViewer(id, viewerSessionId, userId);
      await pollingManager.ensurePolling(host, userId);

      const cached = pollingManager.getStats(id);
      if (cached) {
        return res.json({
          success: true,
          viewerSessionId,
          ...cached.data,
          lastChecked: new Date(cached.timestamp).toISOString(),
        });
      }

      const errorState = pollingManager.getError(id);
      if (errorState) {
        return res.json({
          success: true,
          viewerSessionId,
          status: "error",
          error: errorState.error,
        });
      }

      return res.json({
        success: true,
        viewerSessionId,
        status: "collecting",
      });
    } catch (error) {
      statsLogger.error("Failed to start proxmox stats collection", {
        operation: "proxmox_stats_start_error",
        hostId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error:
          getErrorMessage(error, "Failed to start proxmox stats collection"),
      });
    }
  });

  /**
   * @openapi
   * /proxmox-stats/stop/{id}:
   *   post:
   *     summary: Stop Proxmox stats collection
   *     description: Unregisters a viewer session for a host's Proxmox node stats polling.
   *     tags:
   *       - Proxmox Stats
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               viewerSessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Polling stopped successfully.
   *       401:
   *         description: Session expired - please log in again.
   */
  app.post("/proxmox-stats/stop/:id", validateHostId, async (req, res) => {
    const id = Number(req.params.id);
    const userId = (req as AuthenticatedRequest).userId;
    const { viewerSessionId } = req.body as { viewerSessionId?: string };

    if (DataCrypto.getUserDataKey(userId) === null) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    try {
      if (viewerSessionId && typeof viewerSessionId === "string") {
        pollingManager.unregisterViewer(id, viewerSessionId);
      }
      res.json({ success: true });
    } catch (error) {
      statsLogger.error("Failed to stop proxmox stats collection", {
        operation: "proxmox_stats_stop_error",
        hostId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error:
          getErrorMessage(error, "Failed to stop proxmox stats collection"),
      });
    }
  });
}
