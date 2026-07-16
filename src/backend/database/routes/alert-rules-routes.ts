import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { createCurrentAlertRepository } from "../repositories/current-alert-repository.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { sendWebhook, sendNtfy } from "../../utils/notification-sender.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const VALID_TRIGGER_TYPES = new Set([
  "host_offline",
  "host_online",
  "cpu_threshold",
  "memory_threshold",
  "disk_threshold",
  "health_check_failure",
  "health_check_recovery",
  "user_login",
]);

router.use(authenticateJWT);

// ---- Notification Channels ----

/**
 * @openapi
 * /notification-channels:
 *   get:
 *     summary: List notification channels for the current user
 *     tags:
 *       - Alerts
 *     responses:
 *       200:
 *         description: List of notification channels.
 */
router.get("/notification-channels", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows =
      await createCurrentAlertRepository().listNotificationChannels(userId);
    res.json(rows);
  } catch (err) {
    databaseLogger.error("Failed to list notification channels", {
      operation: "list_channels",
      error: err,
    });
    res.status(500).json({ error: "Failed to list channels" });
  }
});

/**
 * @openapi
 * /notification-channels:
 *   post:
 *     summary: Create a notification channel
 *     tags:
 *       - Alerts
 */
router.post("/notification-channels", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { name, type, config, enabled } = req.body as {
    name: string;
    type: string;
    config: unknown;
    enabled?: boolean;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (type !== "webhook" && type !== "ntfy") {
    return res.status(400).json({ error: "type must be 'webhook' or 'ntfy'" });
  }
  if (!config || typeof config !== "object") {
    return res.status(400).json({ error: "config is required" });
  }
  if (type === "ntfy") {
    const c = config as Record<string, unknown>;
    if (!c.url || typeof c.url !== "string")
      return res.status(400).json({ error: "ntfy config requires url" });
    if (!c.topic || typeof c.topic !== "string")
      return res.status(400).json({ error: "ntfy config requires topic" });
  }
  if (type === "webhook") {
    const c = config as Record<string, unknown>;
    if (!c.url || typeof c.url !== "string")
      return res.status(400).json({ error: "webhook config requires url" });
  }

  try {
    const row = await createCurrentAlertRepository().createNotificationChannel({
      userId,
      name: name.trim(),
      type,
      config: JSON.stringify(config),
      enabled: enabled !== false,
    });
    res.status(201).json(row);
  } catch (err) {
    databaseLogger.error("Failed to create notification channel", {
      operation: "create_channel",
      error: err,
    });
    res.status(500).json({ error: "Failed to create channel" });
  }
});

/**
 * @openapi
 * /notification-channels/{id}:
 *   put:
 *     summary: Update a notification channel
 *     tags:
 *       - Alerts
 */
router.put(
  "/notification-channels/:id",
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const channelId = Number(req.params.id);
    const { name, type, config, enabled } = req.body as {
      name?: string;
      type?: string;
      config?: unknown;
      enabled?: boolean;
    };

    const repository = createCurrentAlertRepository();
    const existing = await repository.findNotificationChannelForUser(
      channelId,
      userId,
    );
    if (!existing) return res.status(404).json({ error: "Channel not found" });

    if (type && type !== "webhook" && type !== "ntfy") {
      return res
        .status(400)
        .json({ error: "type must be 'webhook' or 'ntfy'" });
    }
    if (
      name === undefined &&
      type === undefined &&
      config === undefined &&
      enabled === undefined
    ) {
      return res.json({ success: true });
    }

    try {
      const row = await repository.updateNotificationChannel(
        channelId,
        userId,
        {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(config !== undefined ? { config: JSON.stringify(config) } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
        },
      );
      if (!row) return res.status(404).json({ error: "Channel not found" });
      res.json(row);
    } catch (err) {
      databaseLogger.error("Failed to update notification channel", {
        operation: "update_channel",
        error: err,
      });
      res.status(500).json({ error: "Failed to update channel" });
    }
  },
);

/**
 * @openapi
 * /notification-channels/{id}:
 *   delete:
 *     summary: Delete a notification channel
 *     tags:
 *       - Alerts
 */
router.delete(
  "/notification-channels/:id",
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const channelId = Number(req.params.id);
    const deleted =
      await createCurrentAlertRepository().deleteNotificationChannel(
        channelId,
        userId,
      );
    if (!deleted) return res.status(404).json({ error: "Channel not found" });
    res.json({ success: true });
  },
);

/**
 * @openapi
 * /notification-channels/{id}/test:
 *   post:
 *     summary: Send a test notification
 *     tags:
 *       - Alerts
 */
router.post(
  "/notification-channels/:id/test",
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const channelId = Number(req.params.id);
    const row =
      await createCurrentAlertRepository().findNotificationChannelForUser(
        channelId,
        userId,
      );
    if (!row) return res.status(404).json({ error: "Channel not found" });

    const testPayload = {
      hostName: "Test Host",
      hostId: 0,
      triggerType: "test",
      message: "This is a test notification from Termix",
      severity: "info" as const,
      timestamp: new Date().toISOString(),
      ruleId: 0,
      ruleName: "Test",
    };

    try {
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(row.config) as Record<string, unknown>;
      } catch {
        return res
          .status(400)
          .json({ success: false, error: "Invalid channel config" });
      }

      if (row.type === "webhook") {
        await sendWebhook(
          config as unknown as Parameters<typeof sendWebhook>[0],
          testPayload,
        );
      } else if (row.type === "ntfy") {
        await sendNtfy(
          config as unknown as Parameters<typeof sendNtfy>[0],
          testPayload,
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ---- Alert Rules ----

/**
 * @openapi
 * /alert-rules:
 *   get:
 *     summary: List alert rules for the current user
 *     tags:
 *       - Alerts
 */
router.get("/alert-rules", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    res.json(await createCurrentAlertRepository().listAlertRules(userId));
  } catch (err) {
    databaseLogger.error("Failed to list alert rules", {
      operation: "list_alert_rules",
      error: err,
    });
    res.status(500).json({ error: "Failed to list alert rules" });
  }
});

/**
 * @openapi
 * /alert-rules:
 *   post:
 *     summary: Create an alert rule
 *     tags:
 *       - Alerts
 */
router.post("/alert-rules", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const {
    name,
    hostId,
    enabled,
    triggerType,
    thresholdValue,
    thresholdDurationSeconds,
    cooldownMinutes,
    channels = [],
  } = req.body as {
    name: string;
    hostId?: number | null;
    enabled?: boolean;
    triggerType: string;
    thresholdValue?: number | null;
    thresholdDurationSeconds?: number | null;
    cooldownMinutes?: number;
    channels?: number[];
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!VALID_TRIGGER_TYPES.has(triggerType)) {
    return res.status(400).json({ error: "Invalid triggerType" });
  }
  if (thresholdValue != null && (thresholdValue < 0 || thresholdValue > 100)) {
    return res
      .status(400)
      .json({ error: "thresholdValue must be between 0 and 100" });
  }
  if (thresholdDurationSeconds != null && thresholdDurationSeconds < 0) {
    return res
      .status(400)
      .json({ error: "thresholdDurationSeconds must be >= 0" });
  }

  try {
    const now = new Date().toISOString();
    const row = await createCurrentAlertRepository().createAlertRule({
      userId,
      hostId: hostId ?? null,
      name: name.trim(),
      enabled: enabled !== false,
      triggerType,
      thresholdValue: thresholdValue ?? null,
      thresholdDurationSeconds: thresholdDurationSeconds ?? null,
      cooldownMinutes: cooldownMinutes ?? 15,
      channels,
      now,
    });
    res.status(201).json({ ...row, channels });
  } catch (err) {
    databaseLogger.error("Failed to create alert rule", {
      operation: "create_alert_rule",
      error: err,
    });
    res.status(500).json({ error: "Failed to create alert rule" });
  }
});

/**
 * @openapi
 * /alert-rules/{id}:
 *   put:
 *     summary: Update an alert rule
 *     tags:
 *       - Alerts
 */
router.put("/alert-rules/:id", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const ruleId = Number(req.params.id);

  const repository = createCurrentAlertRepository();
  const existing = await repository.findAlertRuleForUser(ruleId, userId);
  if (!existing) return res.status(404).json({ error: "Alert rule not found" });

  const {
    name,
    hostId,
    enabled,
    triggerType,
    thresholdValue,
    thresholdDurationSeconds,
    cooldownMinutes,
    channels,
  } = req.body as {
    name?: string;
    hostId?: number | null;
    enabled?: boolean;
    triggerType?: string;
    thresholdValue?: number | null;
    thresholdDurationSeconds?: number | null;
    cooldownMinutes?: number;
    channels?: number[];
  };

  if (triggerType && !VALID_TRIGGER_TYPES.has(triggerType)) {
    return res.status(400).json({ error: "Invalid triggerType" });
  }

  try {
    const row = await repository.updateAlertRule(ruleId, userId, {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(hostId !== undefined ? { hostId: hostId ?? null } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(triggerType !== undefined ? { triggerType } : {}),
      ...(thresholdValue !== undefined
        ? { thresholdValue: thresholdValue ?? null }
        : {}),
      ...(thresholdDurationSeconds !== undefined
        ? { thresholdDurationSeconds: thresholdDurationSeconds ?? null }
        : {}),
      ...(cooldownMinutes !== undefined ? { cooldownMinutes } : {}),
      ...(channels !== undefined ? { channels } : {}),
      now: new Date().toISOString(),
    });
    if (!row) return res.status(404).json({ error: "Alert rule not found" });
    res.json(row);
  } catch (err) {
    databaseLogger.error("Failed to update alert rule", {
      operation: "update_alert_rule",
      error: err,
    });
    res.status(500).json({ error: "Failed to update alert rule" });
  }
});

/**
 * @openapi
 * /alert-rules/{id}:
 *   delete:
 *     summary: Delete an alert rule
 *     tags:
 *       - Alerts
 */
router.delete("/alert-rules/:id", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const ruleId = Number(req.params.id);
  const deleted = await createCurrentAlertRepository().deleteAlertRule(
    ruleId,
    userId,
  );
  if (!deleted) return res.status(404).json({ error: "Alert rule not found" });
  res.json({ success: true });
});

// ---- Alert Firings ----

/**
 * @openapi
 * /alert-firings:
 *   get:
 *     summary: List alert firings for the current user
 *     tags:
 *       - Alerts
 */
router.get("/alert-firings", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const acknowledgedParam = req.query.acknowledged;

  try {
    const acknowledged =
      acknowledgedParam === "true"
        ? true
        : acknowledgedParam === "false"
          ? false
          : undefined;
    res.json(
      await createCurrentAlertRepository().listAlertFirings({
        userId,
        acknowledged,
        limit,
        offset,
      }),
    );
  } catch (err) {
    databaseLogger.error("Failed to list alert firings", {
      operation: "list_alert_firings",
      error: err,
    });
    res.status(500).json({ error: "Failed to list alert firings" });
  }
});

/**
 * @openapi
 * /alert-firings/{id}/acknowledge:
 *   post:
 *     summary: Acknowledge an alert firing
 *     tags:
 *       - Alerts
 */
router.post(
  "/alert-firings/:id/acknowledge",
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const firingId = Number(req.params.id);
    await createCurrentAlertRepository().acknowledgeFiring(firingId, userId);
    res.json({ success: true });
  },
);

/**
 * @openapi
 * /alert-firings/acknowledge-all:
 *   post:
 *     summary: Acknowledge all alert firings for the current user
 *     tags:
 *       - Alerts
 */
router.post("/alert-firings/acknowledge-all", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  await createCurrentAlertRepository().acknowledgeAllFirings(userId);
  res.json({ success: true });
});

export default router;
