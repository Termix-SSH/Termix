import type { Express, RequestHandler } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { getDb, DatabaseSaveTrigger } from "../database/db/index.js";
import { statsLogger } from "../utils/logger.js";
import {
  deriveEnabledWidgets,
  defaultLayoutFromWidgets,
  type HostMetricsLayout,
} from "../../types/host-metrics.js";

interface PrefStatsConfig {
  enabledWidgets?: string[];
}

interface PrefHost {
  id: number;
  userId: string;
  statsConfig?: unknown;
}

type HostMetricsPreferencesRoutesDeps = {
  validateHostId: RequestHandler;
  fetchHostById: (hostId: number, userId: string) => Promise<PrefHost | null>;
  parseStatsConfig: (statsConfig: unknown) => PrefStatsConfig;
  canAccessHost: (
    userId: string,
    hostId: number,
    level: "read" | "execute",
  ) => Promise<boolean>;
};

function sanitizeLayout(input: unknown): HostMetricsLayout | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  if (!Array.isArray(obj.slots)) return null;
  const columns =
    typeof obj.columns === "number" && obj.columns >= 1 && obj.columns <= 4
      ? Math.round(obj.columns)
      : 3;
  const slots = obj.slots
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s, i) => ({
      id: String(s.id),
      order: typeof s.order === "number" ? s.order : i,
      colSpan:
        s.colSpan === 1 || s.colSpan === 2 || s.colSpan === 3 ? s.colSpan : 1,
      height:
        typeof s.height === "number" && s.height > 0
          ? Math.round(s.height)
          : null,
    }))
    .filter((s) => s.id && s.id !== "undefined");
  return { slots, columns } as HostMetricsLayout;
}

export function registerHostMetricsPreferencesRoutes(
  app: Express,
  {
    validateHostId,
    fetchHostById,
    parseStatsConfig,
    canAccessHost,
  }: HostMetricsPreferencesRoutesDeps,
): void {
  /**
   * @openapi
   * /host-metrics/preferences/{id}:
   *   get:
   *     summary: Get the Host Metrics layout for a host
   *     description: Returns the current user's saved card layout for the host, or a default layout derived from the host's enabled widgets when none is saved.
   *     tags:
   *       - Host Metrics
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The layout for this host.
   *       403:
   *         description: No access to this host.
   *       404:
   *         description: Host not found.
   */
  app.get("/host-metrics/preferences/:id", validateHostId, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = parseInt(String(req.params.id), 10);
    try {
      if (!(await canAccessHost(userId, hostId, "read"))) {
        return res.status(403).json({ error: "No access to this host" });
      }
      const host = await fetchHostById(hostId, userId);
      if (!host) {
        return res.status(404).json({ error: "Host not found" });
      }

      const db = getDb();
      const row = db.$client
        .prepare(
          "SELECT layout FROM host_metrics_preferences WHERE user_id = ? AND host_id = ?",
        )
        .get(userId, hostId) as { layout: string } | undefined;

      if (row?.layout) {
        try {
          const parsed = sanitizeLayout(JSON.parse(row.layout));
          if (parsed) return res.json({ layout: parsed });
        } catch {
          // fall through to default
        }
      }

      const statsConfig = parseStatsConfig(host.statsConfig);
      const layout = defaultLayoutFromWidgets(statsConfig.enabledWidgets ?? []);
      return res.json({ layout });
    } catch (error) {
      statsLogger.error("Failed to fetch host metrics preferences", {
        operation: "host_metrics_prefs_fetch_error",
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
      return res
        .status(500)
        .json({ error: "Failed to fetch host metrics preferences" });
    }
  });

  /**
   * @openapi
   * /host-metrics/preferences/{id}:
   *   post:
   *     summary: Save the Host Metrics layout for a host
   *     description: Persists the current user's card layout for the host and keeps statsConfig.enabledWidgets in sync (for hosts the user owns) so the mobile app keeps working.
   *     tags:
   *       - Host Metrics
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
   *               slots:
   *                 type: array
   *               columns:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Layout saved.
   *       400:
   *         description: Invalid layout.
   *       403:
   *         description: No access to this host.
   */
  app.post(
    "/host-metrics/preferences/:id",
    validateHostId,
    async (req, res) => {
      const userId = (req as AuthenticatedRequest).userId;
      const hostId = parseInt(String(req.params.id), 10);
      try {
        if (!(await canAccessHost(userId, hostId, "read"))) {
          return res.status(403).json({ error: "No access to this host" });
        }
        const host = await fetchHostById(hostId, userId);
        if (!host) {
          return res.status(404).json({ error: "Host not found" });
        }

        const layout = sanitizeLayout(req.body);
        if (!layout) {
          return res.status(400).json({ error: "Invalid layout" });
        }

        const db = getDb();
        const now = new Date().toISOString();
        const layoutJson = JSON.stringify(layout);

        const existing = db.$client
          .prepare(
            "SELECT id FROM host_metrics_preferences WHERE user_id = ? AND host_id = ?",
          )
          .get(userId, hostId) as { id: number } | undefined;

        if (existing) {
          db.$client
            .prepare(
              "UPDATE host_metrics_preferences SET layout = ?, updated_at = ? WHERE id = ?",
            )
            .run(layoutJson, now, existing.id);
        } else {
          db.$client
            .prepare(
              "INSERT INTO host_metrics_preferences (user_id, host_id, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(userId, hostId, layoutJson, now, now);
        }

        // Keep statsConfig.enabledWidgets in sync (mobile contract) for hosts the
        // user owns. stats_config is plain JSON text (not an encrypted field).
        if (host.userId === userId) {
          try {
            const current = parseStatsConfig(host.statsConfig);
            const merged = {
              ...current,
              enabledWidgets: deriveEnabledWidgets(layout.slots),
            };
            db.$client
              .prepare(
                "UPDATE ssh_data SET stats_config = ? WHERE id = ? AND user_id = ?",
              )
              .run(JSON.stringify(merged), hostId, userId);
          } catch (syncErr) {
            statsLogger.warn("Failed to sync enabledWidgets from layout", {
              operation: "host_metrics_prefs_sync_widgets",
              hostId,
              error:
                syncErr instanceof Error ? syncErr.message : String(syncErr),
            });
          }
        }

        DatabaseSaveTrigger.triggerSave("host_metrics_preferences_updated");
        return res.json({ success: true });
      } catch (error) {
        statsLogger.error("Failed to save host metrics preferences", {
          operation: "host_metrics_prefs_save_error",
          hostId,
          error: error instanceof Error ? error.message : String(error),
        });
        return res
          .status(500)
          .json({ error: "Failed to save host metrics preferences" });
      }
    },
  );
}
