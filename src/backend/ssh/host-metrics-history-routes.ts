import type { Express, RequestHandler } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { getDb } from "../database/db/index.js";
import { statsLogger } from "../utils/logger.js";

type HistoryRoutesDeps = {
  validateHostId: RequestHandler;
  canAccessHost: (
    userId: string,
    hostId: number,
    level: "read" | "write" | "execute" | "delete" | "share",
  ) => Promise<boolean>;
};

const RANGE_OFFSETS: Record<string, number> = {
  "1h": 1 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function registerHostMetricsHistoryRoutes(
  app: Express,
  { validateHostId, canAccessHost }: HistoryRoutesDeps,
): void {
  /**
   * @openapi
   * /metrics/history/{id}:
   *   get:
   *     summary: Get historical metrics for a host
   *     tags:
   *       - Host Metrics
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: range
   *         schema:
   *           type: string
   *           enum: [1h, 6h, 24h, 7d, 30d]
   *       - in: query
   *         name: from
   *         schema:
   *           type: string
   *           format: date-time
   *       - in: query
   *         name: to
   *         schema:
   *           type: string
   *           format: date-time
   *     responses:
   *       200:
   *         description: Array of metric history rows.
   *       403:
   *         description: Access denied.
   *       404:
   *         description: Host not found or no access.
   */
  app.get("/metrics/history/:id", validateHostId, async (req, res) => {
    const hostId = Number(req.params.id);
    const userId = (req as AuthenticatedRequest).userId;

    try {
      const hasAccess = await canAccessHost(userId, hostId, "read");
      if (!hasAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { range, from, to } = req.query as Record<
        string,
        string | undefined
      >;

      let fromTs: string;
      let toTs: string = new Date().toISOString();

      if (range) {
        const offsetMs = RANGE_OFFSETS[range];
        if (!offsetMs) {
          return res
            .status(400)
            .json({ error: "Invalid range. Use 1h, 6h, 24h, 7d, or 30d" });
        }
        fromTs = new Date(Date.now() - offsetMs).toISOString();
      } else if (from && to) {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          return res.status(400).json({ error: "Invalid from/to date format" });
        }
        fromTs = fromDate.toISOString();
        toTs = toDate.toISOString();
      } else {
        fromTs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      }

      const db = getDb();
      // SQLite CURRENT_TIMESTAMP stores 'YYYY-MM-DD HH:MM:SS' (no T/Z).
      // Normalize both sides to that format for reliable string comparison.
      const toSqlite = (iso: string) =>
        iso.replace("T", " ").replace(/\.\d{3}Z$/, "");
      const rows = db.$client
        .prepare(
          `SELECT ts, cpu_percent, mem_percent, disk_percent, net_rx_bytes, net_tx_bytes
           FROM host_metrics_history
           WHERE host_id = ? AND ts >= ? AND ts <= ?
           ORDER BY ts ASC`,
        )
        .all(hostId, toSqlite(fromTs), toSqlite(toTs));

      res.json({ rows, fromTs, toTs });
    } catch (error) {
      statsLogger.error("Failed to fetch metrics history", {
        operation: "metrics_history_fetch_error",
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to fetch metrics history" });
    }
  });
}
