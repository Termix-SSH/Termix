import type { Express, RequestHandler } from "express";
import { getDb } from "../database/db/index.js";
import { statsLogger } from "../utils/logger.js";

type HostMetricsSettingsConfig = {
  statusCheckInterval: number;
  metricsInterval: number;
};

type HostMetricsSettingsRoutesDeps = {
  requireAdmin: RequestHandler;
  defaultStatsConfig: HostMetricsSettingsConfig;
  refreshAllPolling: () => Promise<void>;
};

export function registerHostMetricsSettingsRoutes(
  app: Express,
  {
    requireAdmin,
    defaultStatsConfig: DEFAULT_STATS_CONFIG,
    refreshAllPolling,
  }: HostMetricsSettingsRoutesDeps,
): void {
  /**
   * @openapi
   * /global-settings:
   *   get:
   *     summary: Get global monitoring defaults
   *     tags:
   *       - Host Metrics
   *     responses:
   *       200:
   *         description: Global monitoring settings.
   *       403:
   *         description: Requires admin privileges.
   */
  app.get("/global-settings", requireAdmin, async (_req, res) => {
    try {
      const db = getDb();

      try {
        db.$client.prepare("SELECT 1 FROM settings LIMIT 1").get();
      } catch (tableError) {
        statsLogger.warn("Settings table does not exist, using defaults", {
          operation: "global_settings_table_check",
          error:
            tableError instanceof Error
              ? tableError.message
              : String(tableError),
        });
        return res.json({
          statusCheckInterval: DEFAULT_STATS_CONFIG.statusCheckInterval,
          metricsInterval: DEFAULT_STATS_CONFIG.metricsInterval,
        });
      }

      const statusRow = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'global_status_check_interval'",
        )
        .get() as { value: string } | undefined;
      const metricsRow = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'global_metrics_interval'",
        )
        .get() as { value: string } | undefined;

      res.json({
        statusCheckInterval: statusRow
          ? parseInt(statusRow.value, 10)
          : DEFAULT_STATS_CONFIG.statusCheckInterval,
        metricsInterval: metricsRow
          ? parseInt(metricsRow.value, 10)
          : DEFAULT_STATS_CONFIG.metricsInterval,
      });
    } catch (error) {
      statsLogger.error("Failed to fetch global settings", {
        operation: "global_settings_fetch_error",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to fetch global settings" });
    }
  });

  /**
   * @openapi
   * /global-settings:
   *   post:
   *     summary: Update global monitoring defaults
   *     tags:
   *       - Host Metrics
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               statusCheckInterval:
   *                 type: integer
   *               metricsInterval:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Settings saved.
   *       400:
   *         description: Invalid parameters.
   *       403:
   *         description: Requires admin privileges.
   */
  app.post("/global-settings", requireAdmin, async (req, res) => {
    const { statusCheckInterval, metricsInterval } = req.body;

    if (
      statusCheckInterval !== undefined &&
      (typeof statusCheckInterval !== "number" ||
        statusCheckInterval < 5 ||
        statusCheckInterval > 3600)
    ) {
      return res.status(400).json({
        error: "statusCheckInterval must be between 5 and 3600 seconds",
      });
    }
    if (
      metricsInterval !== undefined &&
      (typeof metricsInterval !== "number" ||
        metricsInterval < 5 ||
        metricsInterval > 3600)
    ) {
      return res
        .status(400)
        .json({ error: "metricsInterval must be between 5 and 3600 seconds" });
    }

    try {
      const db = getDb();

      try {
        db.$client.prepare("SELECT 1 FROM settings LIMIT 1").get();
      } catch (tableError) {
        statsLogger.error(
          "Settings table does not exist, cannot save settings",
          {
            operation: "global_settings_table_check",
            error:
              tableError instanceof Error
                ? tableError.message
                : String(tableError),
          },
        );
        return res.status(500).json({
          error:
            "Database settings table is missing. Please check database initialization.",
        });
      }

      if (statusCheckInterval !== undefined) {
        db.$client
          .prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('global_status_check_interval', ?)",
          )
          .run(String(statusCheckInterval));
      }
      if (metricsInterval !== undefined) {
        db.$client
          .prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('global_metrics_interval', ?)",
          )
          .run(String(metricsInterval));
      }

      await refreshAllPolling();

      res.json({
        success: true,
        message: "Settings updated and polling refreshed",
      });
    } catch (error) {
      statsLogger.error("Failed to save global settings", {
        operation: "global_settings_save_error",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error: "Failed to save global settings",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * @openapi
   * /global-settings/history:
   *   get:
   *     summary: Get metrics history retention setting
   *     tags:
   *       - Host Metrics
   *     responses:
   *       200:
   *         description: Retention setting in days.
   *       403:
   *         description: Requires admin privileges.
   */
  app.get("/global-settings/history", requireAdmin, (_req, res) => {
    try {
      const db = getDb();
      const row = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'metrics_history_retention_days'",
        )
        .get() as { value: string } | undefined;
      const days = row ? parseInt(row.value, 10) : 7;
      res.json({ metricsHistoryRetentionDays: isNaN(days) ? 7 : days });
    } catch (error) {
      statsLogger.error("Failed to fetch history retention setting", {
        operation: "history_retention_fetch_error",
        error: error instanceof Error ? error.message : String(error),
      });
      res
        .status(500)
        .json({ error: "Failed to fetch history retention setting" });
    }
  });

  /**
   * @openapi
   * /global-settings/history:
   *   post:
   *     summary: Update metrics history retention setting
   *     tags:
   *       - Host Metrics
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               metricsHistoryRetentionDays:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 90
   *     responses:
   *       200:
   *         description: Setting saved.
   *       400:
   *         description: Invalid value.
   *       403:
   *         description: Requires admin privileges.
   */
  app.post("/global-settings/history", requireAdmin, (req, res) => {
    const { metricsHistoryRetentionDays } = req.body;
    if (
      typeof metricsHistoryRetentionDays !== "number" ||
      metricsHistoryRetentionDays < 1 ||
      metricsHistoryRetentionDays > 90
    ) {
      return res.status(400).json({
        error: "metricsHistoryRetentionDays must be between 1 and 90",
      });
    }
    try {
      const db = getDb();
      db.$client
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('metrics_history_retention_days', ?)",
        )
        .run(String(Math.floor(metricsHistoryRetentionDays)));
      res.json({ success: true });
    } catch (error) {
      statsLogger.error("Failed to save history retention setting", {
        operation: "history_retention_save_error",
        error: error instanceof Error ? error.message : String(error),
      });
      res
        .status(500)
        .json({ error: "Failed to save history retention setting" });
    }
  });
}
