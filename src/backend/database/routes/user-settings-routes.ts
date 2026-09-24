import type { AuthenticatedRequest } from "../../../types/index.js";
import { getErrorMessage } from "../../utils/error-message.js";
import type { RequestHandler, Router } from "express";
import {
  authLogger,
  getGlobalLogLevel,
  setGlobalLogLevel,
} from "../../utils/logger.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  AUDIT_FORWARD_TOKEN_SETTING,
  AUDIT_FORWARD_URL_ENV,
  AUDIT_FORWARD_URL_SETTING,
} from "../../utils/audit-forwarder.js";
import { getTelemetryEnvOverride } from "../../utils/analytics.js";
import { STEP_CA_PRIVATE_ALLOWLIST_KEY } from "../../utils/step-ca-egress.js";
import { SECRET_SOURCE_PRIVATE_ALLOWLIST_KEY } from "../../utils/secret-source-egress.js";
import {
  NOTIFICATION_PRIVATE_ALLOWLIST_KEY,
  parseNotificationAllowlist,
} from "../../utils/notification-egress.js";
import {
  createCurrentSettingsRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import type { UserRecord } from "../repositories/user-repository.js";

export type HostDefaults = {
  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  credentialId?: number | null;
  statusCheckEnabled?: boolean;
  fontSize?: number;
  fontFamily?: string;
  theme?: string;
  cursorStyle?: string;
  cursorBlink?: boolean;
  enableSessionLogging?: boolean;
  enableCommandHistory?: boolean;
  autoTmux?: boolean;
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
   * /users/analytics-enabled:
   *   get:
   *     summary: Get analytics enabled setting
   *     description: Returns whether anonymous usage telemetry is enabled, and whether the value is locked by the ENABLE_TELEMETRY environment variable.
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
   *                 locked:
   *                   type: boolean
   */
  router.get("/analytics-enabled", authenticateJWT, async (_req, res) => {
    try {
      const override = getTelemetryEnvOverride();
      if (override !== null) {
        return res.json({ enabled: override, locked: true });
      }
      res.json({
        enabled: await createCurrentSettingsRepository().getBoolean(
          "analytics_enabled",
          true,
        ),
        locked: false,
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
   *       409:
   *         description: Setting is locked by the ENABLE_TELEMETRY environment variable.
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
      if (getTelemetryEnvOverride() !== null) {
        return res.status(409).json({
          error: "Telemetry is locked by the ENABLE_TELEMETRY env variable",
        });
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
   * /users/session-sharing-enabled:
   *   get:
   *     summary: Get session sharing globally enabled setting
   *     description: Returns whether live session sharing (terminal/RDP/VNC/Telnet share links and in-app joins) is allowed instance-wide. Overrides every per-host toggle when false.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Session sharing enabled status.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 enabled:
   *                   type: boolean
   */
  /**
   * @openapi
   * /users/audit-forwarding:
   *   get:
   *     summary: Get audit log forwarding settings (admin only)
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Forwarding target. The token itself is never returned.
   */
  router.get("/audit-forwarding", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      if (!(await getAdminActor(userId))) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const settingsRepository = createCurrentSettingsRepository();
      const url =
        (await settingsRepository.get(AUDIT_FORWARD_URL_SETTING)) ?? "";
      const hasToken = !!(await settingsRepository.get(
        AUDIT_FORWARD_TOKEN_SETTING,
      ));
      res.json({
        url,
        hasToken,
        envConfigured: !!process.env[AUDIT_FORWARD_URL_ENV]?.trim(),
      });
    } catch (err) {
      authLogger.error("Failed to get audit forwarding settings", err);
      res
        .status(500)
        .json({ error: "Failed to get audit forwarding settings" });
    }
  });

  /**
   * @openapi
   * /users/audit-forwarding:
   *   patch:
   *     summary: Update audit log forwarding settings (admin only)
   *     description: Sets the collector URL audit entries are shipped to. An empty URL disables forwarding and clears the stored token. Omitting token keeps the stored one.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               url:
   *                 type: string
   *               token:
   *                 type: string
   *     responses:
   *       200:
   *         description: Setting updated.
   *       403:
   *         description: Not authorized.
   */
  router.patch("/audit-forwarding", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const actor = await getAdminActor(userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { url, token } = req.body ?? {};
      if (
        typeof url !== "string" ||
        (token !== undefined && typeof token !== "string")
      ) {
        return res.status(400).json({ error: "url must be a string" });
      }
      const trimmedUrl = url.trim();
      if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
        return res.status(400).json({ error: "url must be http(s)" });
      }

      const settingsRepository = createCurrentSettingsRepository();
      if (!trimmedUrl) {
        await settingsRepository.delete(AUDIT_FORWARD_URL_SETTING);
        await settingsRepository.delete(AUDIT_FORWARD_TOKEN_SETTING);
      } else {
        await settingsRepository.set(AUDIT_FORWARD_URL_SETTING, trimmedUrl);
        if (token !== undefined) {
          if (token.trim()) {
            await settingsRepository.set(
              AUDIT_FORWARD_TOKEN_SETTING,
              token.trim(),
            );
          } else {
            await settingsRepository.delete(AUDIT_FORWARD_TOKEN_SETTING);
          }
        }
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "update_audit_forwarding",
        resourceType: "setting",
        details: JSON.stringify({ enabled: !!trimmedUrl }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ url: trimmedUrl, hasToken: !!token?.trim() });
    } catch (err) {
      authLogger.error("Failed to update audit forwarding settings", err);
      res
        .status(500)
        .json({ error: "Failed to update audit forwarding settings" });
    }
  });

  /**
   * GET/PATCH a comma-list of private hosts an outbound feature may reach.
   * Shared by notifications and Step CA; each keeps its own setting key.
   */
  const registerPrivateEndpointAllowlist = (
    path: string,
    settingKey: string,
    auditAction: string,
    label: string,
  ) => {
    router.get(path, authenticateJWT, async (req, res) => {
      const userId = (req as AuthenticatedRequest).userId;
      try {
        if (!(await getAdminActor(userId))) {
          return res.status(403).json({ error: "Not authorized" });
        }
        const raw = await createCurrentSettingsRepository().get(settingKey);
        res.json({ hosts: parseNotificationAllowlist(raw) });
      } catch (err) {
        authLogger.error(`Failed to get ${label} allowlist`, err);
        res.status(500).json({ error: "Failed to get the allowlist" });
      }
    });

    router.patch(path, authenticateJWT, async (req, res) => {
      const userId = (req as AuthenticatedRequest).userId;
      try {
        const actor = await getAdminActor(userId);
        if (!actor) {
          return res.status(403).json({ error: "Not authorized" });
        }

        const { hosts } = req.body;
        if (!Array.isArray(hosts)) {
          return res.status(400).json({ error: "hosts must be an array" });
        }
        if (hosts.length > 50) {
          return res
            .status(400)
            .json({ error: "At most 50 hosts are allowed" });
        }
        const cleaned: string[] = [];
        for (const entry of hosts) {
          if (typeof entry !== "string") {
            return res
              .status(400)
              .json({ error: "Each host must be a string" });
          }
          const host = entry.trim().toLowerCase();
          if (!host) continue;
          if (!/^[a-z0-9._:-]+$/.test(host)) {
            return res
              .status(400)
              .json({ error: `${entry} is not a valid hostname` });
          }
          if (!cleaned.includes(host)) cleaned.push(host);
        }

        await createCurrentSettingsRepository().set(
          settingKey,
          JSON.stringify(cleaned),
        );
        const { ipAddress, userAgent } = getRequestMeta(req);
        await logAudit({
          userId,
          username: actor.username ?? userId,
          action: auditAction,
          resourceType: "setting",
          details: JSON.stringify({ hosts: cleaned }),
          ipAddress,
          userAgent,
          success: true,
        });
        res.json({ hosts: cleaned });
      } catch (err) {
        authLogger.error(`Failed to update ${label} allowlist`, err);
        res.status(500).json({ error: "Failed to update the allowlist" });
      }
    });
  };

  /**
   * @openapi
   * /users/notification-private-endpoints:
   *   get:
   *     summary: Get the private hosts notification channels may contact (admin only)
   *     tags:
   *       - Users
   *   patch:
   *     summary: Replace that allowlist (admin only)
   *     tags:
   *       - Users
   */
  registerPrivateEndpointAllowlist(
    "/notification-private-endpoints",
    NOTIFICATION_PRIVATE_ALLOWLIST_KEY,
    "update_notification_private_endpoints",
    "notification endpoint",
  );

  /**
   * @openapi
   * /users/step-ca-private-endpoints:
   *   get:
   *     summary: Get the private hosts the Step CA certificate flow may contact (admin only)
   *     tags:
   *       - Users
   *   patch:
   *     summary: Replace that allowlist (admin only)
   *     tags:
   *       - Users
   */
  registerPrivateEndpointAllowlist(
    "/step-ca-private-endpoints",
    STEP_CA_PRIVATE_ALLOWLIST_KEY,
    "update_step_ca_private_endpoints",
    "Step CA endpoint",
  );

  /**
   * @openapi
   * /users/secret-source-private-endpoints:
   *   get:
   *     summary: Get the private hosts secret sources (1Password Connect) may contact (admin only)
   *     tags:
   *       - Users
   *   patch:
   *     summary: Replace that allowlist (admin only)
   *     tags:
   *       - Users
   */
  registerPrivateEndpointAllowlist(
    "/secret-source-private-endpoints",
    SECRET_SOURCE_PRIVATE_ALLOWLIST_KEY,
    "update_secret_source_private_endpoints",
    "secret source endpoint",
  );

  /**
   * @openapi
   * /users/step-ca-settings:
   *   get:
   *     summary: Step CA settings. Admins get the values; everyone else only whether it is configured.
   *     tags:
   *       - Users
   *   patch:
   *     summary: Set the Step CA URL, root fingerprint and OIDC provisioner (admin only). Empty values clear the configuration.
   *     tags:
   *       - Users
   */
  router.get("/step-ca-settings", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const { readStepCaSettings } =
        await import("../../hosts/step-ca-auth.js");
      const settings = await readStepCaSettings();
      if (!(await getAdminActor(userId))) {
        return res.json({ configured: settings !== null });
      }
      res.json({
        configured: settings !== null,
        caUrl: settings?.caUrl ?? "",
        fingerprint: settings?.fingerprint ?? "",
        provisioner: settings?.provisioner ?? "",
      });
    } catch (err) {
      authLogger.error("Failed to get Step CA settings", err);
      res.status(500).json({ error: "Failed to get Step CA settings" });
    }
  });

  router.patch("/step-ca-settings", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const actor = await getAdminActor(userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const { caUrl, fingerprint, provisioner } = req.body ?? {};
      if (
        [caUrl, fingerprint, provisioner].some((v) => typeof v !== "string")
      ) {
        return res.status(400).json({
          error: "caUrl, fingerprint and provisioner must be strings",
        });
      }
      const values = {
        caUrl: caUrl.trim(),
        fingerprint: fingerprint.trim(),
        provisioner: provisioner.trim(),
      };
      const clearing =
        !values.caUrl && !values.fingerprint && !values.provisioner;
      if (!clearing) {
        const { normalizeCaUrl, normalizeFingerprint } =
          await import("../../utils/step-ca-client.js");
        try {
          values.caUrl = normalizeCaUrl(values.caUrl);
          values.fingerprint = normalizeFingerprint(values.fingerprint);
        } catch (err) {
          return res.status(400).json({ error: getErrorMessage(err) });
        }
        if (!values.provisioner) {
          return res.status(400).json({ error: "provisioner is required" });
        }
      }

      const { STEP_CA_SETTING_KEYS } =
        await import("../../hosts/step-ca-auth.js");
      const settings = createCurrentSettingsRepository();
      if (clearing) {
        await settings.delete(STEP_CA_SETTING_KEYS.url);
        await settings.delete(STEP_CA_SETTING_KEYS.fingerprint);
        await settings.delete(STEP_CA_SETTING_KEYS.provisioner);
      } else {
        await settings.set(STEP_CA_SETTING_KEYS.url, values.caUrl);
        await settings.set(
          STEP_CA_SETTING_KEYS.fingerprint,
          values.fingerprint,
        );
        await settings.set(
          STEP_CA_SETTING_KEYS.provisioner,
          values.provisioner,
        );
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: actor.username ?? userId,
        action: "update_step_ca_settings",
        resourceType: "setting",
        details: JSON.stringify({ configured: !clearing, caUrl: values.caUrl }),
        ipAddress,
        userAgent,
        success: true,
      });
      res.json({ configured: !clearing, ...values });
    } catch (err) {
      authLogger.error("Failed to update Step CA settings", err);
      res.status(500).json({ error: "Failed to update Step CA settings" });
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
