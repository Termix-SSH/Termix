import type { Express } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { statsLogger } from "../utils/logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";

type ViewerStatsConfig = {
  metricsEnabled: boolean;
};

type HostMetricsViewerRoutesDeps<
  THost extends { statsConfig?: string | TStatsConfig },
  TStatsConfig extends ViewerStatsConfig,
> = {
  fetchHostById: (hostId: number, userId: string) => Promise<THost>;
  supportsMetrics: (host: THost) => boolean;
  parseStatsConfig: (statsConfig: THost["statsConfig"]) => TStatsConfig;
  updateHeartbeat: (viewerSessionId: string) => boolean;
  registerViewer: (
    hostId: number,
    viewerSessionId: string,
    userId: string,
  ) => void;
  unregisterViewer: (hostId: number, viewerSessionId: string) => void;
};

export function registerHostMetricsViewerRoutes<
  THost extends { statsConfig?: string | TStatsConfig },
  TStatsConfig extends ViewerStatsConfig,
>(
  app: Express,
  {
    fetchHostById,
    supportsMetrics,
    parseStatsConfig,
    updateHeartbeat,
    registerViewer,
    unregisterViewer,
  }: HostMetricsViewerRoutesDeps<THost, TStatsConfig>,
): void {
  /**
   * @openapi
   * /metrics/heartbeat:
   *   post:
   *     summary: Update viewer heartbeat
   *     description: Updates the heartbeat timestamp for a metrics viewer session to keep it alive.
   *     tags:
   *       - Host Metrics
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               viewerSessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Heartbeat updated successfully.
   *       400:
   *         description: Invalid viewerSessionId.
   *       401:
   *         description: Session expired - please log in again.
   *       404:
   *         description: Viewer session not found.
   *       500:
   *         description: Failed to update heartbeat.
   */
  app.post("/metrics/heartbeat", async (req, res) => {
    const { viewerSessionId } = req.body;
    const userId = (req as AuthenticatedRequest).userId;

    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    if (!viewerSessionId || typeof viewerSessionId !== "string") {
      return res.status(400).json({ error: "Invalid viewerSessionId" });
    }

    try {
      const success = updateHeartbeat(viewerSessionId);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Viewer session not found" });
      }
    } catch (error) {
      statsLogger.error("Failed to update heartbeat", {
        operation: "heartbeat_error",
        viewerSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to update heartbeat" });
    }
  });

  /**
   * @openapi
   * /metrics/register-viewer:
   *   post:
   *     summary: Register metrics viewer
   *     description: Registers a new viewer session for a host to track who is viewing metrics.
   *     tags:
   *       - Host Metrics
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Viewer registered successfully.
   *       400:
   *         description: Invalid hostId.
   *       401:
   *         description: Session expired - please log in again.
   *       500:
   *         description: Failed to register viewer.
   */
  app.post("/metrics/register-viewer", async (req, res) => {
    const { hostId } = req.body;
    const userId = (req as AuthenticatedRequest).userId;

    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    if (!hostId || typeof hostId !== "number") {
      return res.status(400).json({ error: "Invalid hostId" });
    }

    try {
      // Graceful no-op if host is inaccessible, metrics disabled, or host type
      // does not support metrics. The client may call this speculatively, so
      // avoid returning 5xx for expected "no metrics available" scenarios.
      let host: THost | undefined;
      try {
        host = await fetchHostById(hostId, userId);
      } catch (lookupErr) {
        statsLogger.warn(
          "register-viewer host lookup failed (treating as no-op)",
          {
            operation: "register_viewer_lookup",
            hostId,
            userId,
            error:
              lookupErr instanceof Error
                ? lookupErr.message
                : String(lookupErr),
          },
        );
      }

      if (!host) {
        return res.json({
          success: true,
          skipped: true,
          reason: "host_not_found",
        });
      }

      if (!supportsMetrics(host)) {
        return res.json({
          success: true,
          skipped: true,
          reason: "metrics_unsupported",
        });
      }

      const statsConfig = parseStatsConfig(host.statsConfig);
      if (!statsConfig.metricsEnabled) {
        return res.json({
          success: true,
          skipped: true,
          reason: "metrics_disabled",
        });
      }

      const viewerSessionId = `viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      try {
        registerViewer(hostId, viewerSessionId, userId);
      } catch (regErr) {
        statsLogger.warn(
          "pollingManager.registerViewer threw (treating as no-op)",
          {
            operation: "register_viewer_internal",
            hostId,
            userId,
            error: regErr instanceof Error ? regErr.message : String(regErr),
          },
        );
        return res.json({
          success: true,
          skipped: true,
          reason: "register_failed_noop",
        });
      }

      res.json({ success: true, viewerSessionId });
    } catch (error) {
      statsLogger.error("Failed to register viewer", {
        operation: "register_viewer_error",
        hostId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Even on unexpected errors we prefer a graceful client experience: the
      // viewer-registration is purely an optimization and should never break
      // the UI. Report success:false but HTTP 200 so the client can decide.
      res.status(200).json({
        success: false,
        skipped: true,
        reason: "internal_error",
      });
    }
  });

  /**
   * @openapi
   * /metrics/unregister-viewer:
   *   post:
   *     summary: Unregister metrics viewer
   *     description: Unregisters a viewer session when they stop viewing metrics for a host.
   *     tags:
   *       - Host Metrics
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *               viewerSessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Viewer unregistered successfully.
   *       400:
   *         description: Invalid hostId or viewerSessionId.
   *       401:
   *         description: Session expired - please log in again.
   *       500:
   *         description: Failed to unregister viewer.
   */
  app.post("/metrics/unregister-viewer", async (req, res) => {
    const { hostId, viewerSessionId } = req.body;
    const userId = (req as AuthenticatedRequest).userId;

    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
      });
    }

    if (!hostId || typeof hostId !== "number") {
      return res.status(400).json({ error: "Invalid hostId" });
    }

    if (!viewerSessionId || typeof viewerSessionId !== "string") {
      return res.status(400).json({ error: "Invalid viewerSessionId" });
    }

    try {
      unregisterViewer(hostId, viewerSessionId);
      res.json({ success: true });
    } catch (error) {
      statsLogger.error("Failed to unregister viewer", {
        operation: "unregister_viewer_error",
        hostId,
        viewerSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to unregister viewer" });
    }
  });
}
