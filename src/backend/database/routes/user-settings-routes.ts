import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { restartGuacServer } from "../../hosts/guacamole/guacamole-server.js";
import {
  authLogger,
  getGlobalLogLevel,
  setGlobalLogLevel,
} from "../../utils/logger.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  createCurrentSettingsRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import type { UserRecord } from "../repositories/user-repository.js";

function getDefaultGuacUrl(): string {
  return `${process.env.GUACD_HOST || "localhost"}:${process.env.GUACD_PORT || "4822"}`;
}

export type HostDefaults = {
  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  credentialId?: number | null;
  metricsEnabled?: boolean;
  statusCheckEnabled?: boolean;
  fontSize?: number;
  fontFamily?: string;
  theme?: string;
  cursorStyle?: string;
  cursorBlink?: boolean;
  enableSessionLogging?: boolean;
  enableCommandHistory?: boolean;
};

async function getAdminActor(
  userId: string | undefined,
): Promise<UserRecord | null> {
  if (!userId) return null;
  const user = await createCurrentUserRepository().findById(userId);
  return user?.isAdmin ? user : null;
}

export function registerUserSettingsRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/guacamole-settings:
   *   get:
   *     summary: Get Guacamole settings
   *     description: Returns current guacd enabled status and host:port URL. No authentication required.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Guacamole settings.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 enabled:
   *                   type: boolean
   *                 url:
   *                   type: string
   *       500:
   *         description: Failed to get guacamole settings.
   */
  router.get("/guacamole-settings", authenticateJWT, async (_req, res) => {
    try {
      const settings = createCurrentSettingsRepository();
      const enabled = await settings.getBoolean("guac_enabled", true);
      const url = await settings.get("guac_url");
      res.json({
        enabled,
        url: url ?? getDefaultGuacUrl(),
      });
    } catch (err) {
      authLogger.error("Failed to get guacamole settings", err);
      res.status(500).json({ error: "Failed to get guacamole settings" });
    }
  });

  /**
   * @openapi
   * /users/guacamole-settings:
   *   patch:
   *     summary: Update Guacamole settings
   *     description: Admin-only. Updates guacd enabled status and/or host:port URL.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               enabled:
   *                 type: boolean
   *               url:
   *                 type: string
   *     responses:
   *       200:
   *         description: Guacamole settings updated.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to update guacamole settings.
   */
  router.patch("/guacamole-settings", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const actor = await getAdminActor(userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { enabled, url } = req.body;
      const settings = createCurrentSettingsRepository();
      if (typeof enabled === "boolean") {
        await settings.set("guac_enabled", enabled ? "true" : "false");
      }
      if (typeof url === "string") {
        await settings.set("guac_url", url);
        try {
          await restartGuacServer();
        } catch (err) {
          authLogger.error(
            "Failed to restart guac server after URL update",
            err,
          );
        }
      }
      const currentEnabled = await settings.getBoolean("guac_enabled", true);
      const currentUrl = await settings.get("guac_url");

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "update_guacamole_settings",
        resourceType: "setting",
        details: JSON.stringify({ enabled, url }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({
        enabled: currentEnabled,
        url: currentUrl ?? getDefaultGuacUrl(),
      });
    } catch (err) {
      authLogger.error("Failed to update guacamole settings", err);
      res.status(500).json({ error: "Failed to update guacamole settings" });
    }
  });

  /**
   * @openapi
   * /users/log-level:
   *   get:
   *     summary: Get log level setting
   *     description: Returns the configured log verbosity level.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Current log level.
   */
  router.get("/log-level", authenticateJWT, async (_req, res) => {
    try {
      const level = await createCurrentSettingsRepository().get("log_level");
      res.json({
        level: level ?? getGlobalLogLevel(),
      });
    } catch (err) {
      authLogger.error("Failed to get log level", err);
      res.status(500).json({ error: "Failed to get log level" });
    }
  });

  /**
   * @openapi
   * /users/log-level:
   *   patch:
   *     summary: Update log level setting (admin only)
   *     description: Sets the log verbosity level.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Log level updated.
   *       400:
   *         description: Invalid log level.
   *       403:
   *         description: Not authorized.
   */
  router.patch("/log-level", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const actor = await getAdminActor(userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { level } = req.body;
      const validLevels = ["debug", "info", "warn", "error"];
      if (typeof level !== "string" || !validLevels.includes(level)) {
        return res
          .status(400)
          .json({ error: "level must be one of: debug, info, warn, error" });
      }
      await createCurrentSettingsRepository().set("log_level", level);
      setGlobalLogLevel(level);

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "update_log_level",
        resourceType: "setting",
        details: JSON.stringify({ level }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ level });
    } catch (err) {
      authLogger.error("Failed to set log level", err);
      res.status(500).json({ error: "Failed to set log level" });
    }
  });

  /**
   * @openapi
   * /users/session-timeout:
   *   get:
   *     summary: Get session timeout setting
   *     description: Returns the configured session timeout in hours.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Current session timeout hours.
   */
  router.get("/session-timeout", authenticateJWT, async (_req, res) => {
    try {
      const value = await createCurrentSettingsRepository().get(
        "session_timeout_hours",
      );
      res.json({
        timeoutHours: value ? parseInt(value, 10) : 24,
      });
    } catch (err) {
      authLogger.error("Failed to get session timeout", err);
      res.status(500).json({ error: "Failed to get session timeout" });
    }
  });

  /**
   * @openapi
   * /users/session-timeout:
   *   patch:
   *     summary: Update session timeout setting (admin only)
   *     description: Sets the session timeout in hours.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Session timeout updated.
   *       400:
   *         description: Invalid value.
   *       403:
   *         description: Not authorized.
   */
  router.patch("/session-timeout", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const actor = await getAdminActor(userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { timeoutHours } = req.body;
      if (
        typeof timeoutHours !== "number" ||
        timeoutHours < 1 ||
        timeoutHours > 720
      ) {
        return res
          .status(400)
          .json({ error: "timeoutHours must be between 1 and 720" });
      }
      await createCurrentSettingsRepository().set(
        "session_timeout_hours",
        String(timeoutHours),
      );

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "update_session_timeout",
        resourceType: "setting",
        details: JSON.stringify({ timeoutHours }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ timeoutHours });
    } catch (err) {
      authLogger.error("Failed to set session timeout", err);
      res.status(500).json({ error: "Failed to set session timeout" });
    }
  });

  /**
   * @openapi
   * /users/tailscale-settings:
   *   get:
   *     summary: Get Tailscale settings
   *     description: Returns whether a Tailscale API key is configured (value is masked).
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Tailscale settings.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 apiKey:
   *                   type: string
   *                   description: Masked API key or empty string if not set.
   *                 hasApiKey:
   *                   type: boolean
   */
  router.get("/tailscale-settings", authenticateJWT, async (_req, res) => {
    try {
      const apiKey =
        (await createCurrentSettingsRepository().get("tailscale_api_key")) ??
        "";
      res.json({
        apiKey: apiKey
          ? `${apiKey.slice(0, 6)}${"*".repeat(Math.max(0, apiKey.length - 6))}`
          : "",
        hasApiKey: !!apiKey,
      });
    } catch (err) {
      authLogger.error("Failed to get Tailscale settings", err);
      res.status(500).json({ error: "Failed to get Tailscale settings" });
    }
  });

  /**
   * @openapi
   * /users/tailscale-settings:
   *   patch:
   *     summary: Update Tailscale settings (admin only)
   *     description: Saves or clears the Tailscale API key used for device discovery.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               apiKey:
   *                 type: string
   *     responses:
   *       200:
   *         description: Tailscale settings updated.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to update Tailscale settings.
   */
  router.patch("/tailscale-settings", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const actor = await getAdminActor(userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { apiKey } = req.body;
      if (typeof apiKey !== "string") {
        return res.status(400).json({ error: "apiKey must be a string" });
      }
      await createCurrentSettingsRepository().set("tailscale_api_key", apiKey);

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "update_tailscale_settings",
        resourceType: "setting",
        details: JSON.stringify({ hasApiKey: !!apiKey }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ hasApiKey: !!apiKey });
    } catch (err) {
      authLogger.error("Failed to update Tailscale settings", err);
      res.status(500).json({ error: "Failed to update Tailscale settings" });
    }
  });

  /**
   * @openapi
   * /users/command-history-enabled:
   *   get:
   *     summary: Get command history enabled setting
   *     description: Returns whether command history recording is globally enabled.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Command history enabled status.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 enabled:
   *                   type: boolean
   */
  router.get("/command-history-enabled", authenticateJWT, async (_req, res) => {
    try {
      res.json({
        enabled: await createCurrentSettingsRepository().getBoolean(
          "command_history_enabled",
          true,
        ),
      });
    } catch (err) {
      authLogger.error("Failed to get command history enabled setting", err);
      res
        .status(500)
        .json({ error: "Failed to get command history enabled setting" });
    }
  });

  /**
   * @openapi
   * /users/command-history-enabled:
   *   patch:
   *     summary: Update command history enabled setting (admin only)
   *     description: Globally enables or disables command history recording for all hosts.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               enabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Setting updated.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to update setting.
   */
  router.patch(
    "/command-history-enabled",
    authenticateJWT,
    async (req, res) => {
      const userId = (req as AuthenticatedRequest).userId;
      try {
        const actor = await getAdminActor(userId);
        if (!actor) {
          return res.status(403).json({ error: "Not authorized" });
        }
        const { enabled } = req.body;
        if (typeof enabled !== "boolean") {
          return res.status(400).json({ error: "enabled must be a boolean" });
        }
        await createCurrentSettingsRepository().set(
          "command_history_enabled",
          enabled ? "true" : "false",
        );

        const { ipAddress, userAgent } = getRequestMeta(req);
        await logAudit({
          userId,
          username: actor.username ?? userId,
          action: "update_command_history_enabled",
          resourceType: "setting",
          details: JSON.stringify({ enabled }),
          ipAddress,
          userAgent,
          success: true,
        });

        res.json({ enabled });
      } catch (err) {
        authLogger.error(
          "Failed to update command history enabled setting",
          err,
        );
        res
          .status(500)
          .json({ error: "Failed to update command history enabled setting" });
      }
    },
  );

  /**
   * @openapi
   * /users/analytics-enabled:
   *   get:
   *     summary: Get analytics enabled setting
   *     description: Returns whether anonymous usage telemetry is enabled.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Analytics enabled status.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 enabled:
   *                   type: boolean
   */
  router.get("/analytics-enabled", authenticateJWT, async (_req, res) => {
    try {
      res.json({
        enabled: await createCurrentSettingsRepository().getBoolean(
          "analytics_enabled",
          true,
        ),
      });
    } catch (err) {
      authLogger.error("Failed to get analytics enabled setting", err);
      res
        .status(500)
        .json({ error: "Failed to get analytics enabled setting" });
    }
  });

  /**
   * @openapi
   * /users/analytics-enabled:
   *   patch:
   *     summary: Update analytics enabled setting (admin only)
   *     description: Enables or disables the daily anonymous usage telemetry heartbeat.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               enabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Setting updated.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to update setting.
   */
  router.patch("/analytics-enabled", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const actor = await getAdminActor(userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      await createCurrentSettingsRepository().set(
        "analytics_enabled",
        enabled ? "true" : "false",
      );

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "update_analytics_enabled",
        resourceType: "setting",
        details: JSON.stringify({ enabled }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ enabled });
    } catch (err) {
      authLogger.error("Failed to update analytics enabled setting", err);
      res
        .status(500)
        .json({ error: "Failed to update analytics enabled setting" });
    }
  });

  /**
   * @openapi
   * /users/host-defaults:
   *   get:
   *     summary: Get host creation defaults
   *     description: Returns the global default settings applied when creating a new host.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Host defaults object.
   *       500:
   *         description: Failed to get host defaults.
   */
  router.get("/host-defaults", authenticateJWT, async (_req, res) => {
    try {
      const value =
        await createCurrentSettingsRepository().get("host_defaults");
      const defaults: HostDefaults = value ? JSON.parse(value) : {};
      res.json(defaults);
    } catch (err) {
      authLogger.error("Failed to get host defaults", err);
      res.status(500).json({ error: "Failed to get host defaults" });
    }
  });

  /**
   * @openapi
   * /users/host-defaults:
   *   patch:
   *     summary: Update host creation defaults (admin only)
   *     description: Sets global default settings applied when a new host is created.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: Host defaults updated.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to update host defaults.
   */
  router.patch("/host-defaults", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const actor = await getAdminActor(userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const defaults: HostDefaults = req.body;
      await createCurrentSettingsRepository().set(
        "host_defaults",
        JSON.stringify(defaults),
      );

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "update_host_defaults",
        resourceType: "setting",
        details: JSON.stringify(defaults),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json(defaults);
    } catch (err) {
      authLogger.error("Failed to update host defaults", err);
      res.status(500).json({ error: "Failed to update host defaults" });
    }
  });
}
