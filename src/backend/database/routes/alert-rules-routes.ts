import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { getDb } from "../db/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../db/index.js";
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
router.get("/notification-channels", (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows = getDb()
      .$client.prepare(
        "SELECT * FROM notification_channels WHERE user_id = ? ORDER BY id ASC",
      )
      .all(userId);
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
router.post("/notification-channels", (req, res) => {
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
    const result = getDb()
      .$client.prepare(
        `INSERT INTO notification_channels (user_id, name, type, config, enabled)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        name.trim(),
        type,
        JSON.stringify(config),
        enabled !== false ? 1 : 0,
      );
    const row = getDb()
      .$client.prepare("SELECT * FROM notification_channels WHERE id = ?")
      .get(result.lastInsertRowid);
    DatabaseSaveTrigger.triggerSave("notification_channel_created");
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
router.put("/notification-channels/:id", (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const channelId = Number(req.params.id);
  const { name, type, config, enabled } = req.body as {
    name?: string;
    type?: string;
    config?: unknown;
    enabled?: boolean;
  };

  const existing = getDb()
    .$client.prepare(
      "SELECT id FROM notification_channels WHERE id = ? AND user_id = ?",
    )
    .get(channelId, userId);
  if (!existing) return res.status(404).json({ error: "Channel not found" });

  if (type && type !== "webhook" && type !== "ntfy") {
    return res.status(400).json({ error: "type must be 'webhook' or 'ntfy'" });
  }

  try {
    const updates: string[] = [];
    const params: unknown[] = [];
    if (name !== undefined) {
      updates.push("name = ?");
      params.push(name.trim());
    }
    if (type !== undefined) {
      updates.push("type = ?");
      params.push(type);
    }
    if (config !== undefined) {
      updates.push("config = ?");
      params.push(JSON.stringify(config));
    }
    if (enabled !== undefined) {
      updates.push("enabled = ?");
      params.push(enabled ? 1 : 0);
    }

    if (updates.length === 0) return res.json({ success: true });

    params.push(channelId, userId);
    getDb()
      .$client.prepare(
        `UPDATE notification_channels SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      )
      .run(...params);

    const row = getDb()
      .$client.prepare("SELECT * FROM notification_channels WHERE id = ?")
      .get(channelId);
    DatabaseSaveTrigger.triggerSave("notification_channel_updated");
    res.json(row);
  } catch (err) {
    databaseLogger.error("Failed to update notification channel", {
      operation: "update_channel",
      error: err,
    });
    res.status(500).json({ error: "Failed to update channel" });
  }
});

/**
 * @openapi
 * /notification-channels/{id}:
 *   delete:
 *     summary: Delete a notification channel
 *     tags:
 *       - Alerts
 */
router.delete("/notification-channels/:id", (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const channelId = Number(req.params.id);
  const existing = getDb()
    .$client.prepare(
      "SELECT id FROM notification_channels WHERE id = ? AND user_id = ?",
    )
    .get(channelId, userId);
  if (!existing) return res.status(404).json({ error: "Channel not found" });
  getDb()
    .$client.prepare("DELETE FROM notification_channels WHERE id = ?")
    .run(channelId);
  DatabaseSaveTrigger.triggerSave("notification_channel_deleted");
  res.json({ success: true });
});

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
    const row = getDb()
      .$client.prepare(
        "SELECT * FROM notification_channels WHERE id = ? AND user_id = ?",
      )
      .get(channelId, userId) as { type: string; config: string } | undefined;
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
router.get("/alert-rules", (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rules = getDb()
      .$client.prepare(
        "SELECT * FROM alert_rules WHERE user_id = ? ORDER BY id ASC",
      )
      .all(userId) as Array<{ id: number }>;

    const channelMap = new Map<number, number[]>();
    for (const rule of rules) {
      const channels = getDb()
        .$client.prepare(
          "SELECT channel_id FROM alert_rule_channels WHERE rule_id = ?",
        )
        .all(rule.id) as Array<{ channel_id: number }>;
      channelMap.set(
        rule.id,
        channels.map((c) => c.channel_id),
      );
    }

    const result = rules.map((r) => ({
      ...r,
      channels: channelMap.get(r.id) ?? [],
    }));
    res.json(result);
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
router.post("/alert-rules", (req, res) => {
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
    const result = getDb()
      .$client.prepare(
        `INSERT INTO alert_rules
           (user_id, host_id, name, enabled, trigger_type, threshold_value,
            threshold_duration_seconds, cooldown_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        hostId ?? null,
        name.trim(),
        enabled !== false ? 1 : 0,
        triggerType,
        thresholdValue ?? null,
        thresholdDurationSeconds ?? null,
        cooldownMinutes ?? 15,
        now,
        now,
      );
    const ruleId = result.lastInsertRowid as number;

    for (const channelId of channels) {
      const owned = getDb()
        .$client.prepare(
          "SELECT id FROM notification_channels WHERE id = ? AND user_id = ?",
        )
        .get(channelId, userId);
      if (!owned) continue;
      getDb()
        .$client.prepare(
          "INSERT OR IGNORE INTO alert_rule_channels (rule_id, channel_id) VALUES (?, ?)",
        )
        .run(ruleId, channelId);
    }

    const row = getDb()
      .$client.prepare("SELECT * FROM alert_rules WHERE id = ?")
      .get(ruleId) as Record<string, unknown>;
    DatabaseSaveTrigger.triggerSave("alert_rule_created");
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
router.put("/alert-rules/:id", (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const ruleId = Number(req.params.id);

  const existing = getDb()
    .$client.prepare("SELECT id FROM alert_rules WHERE id = ? AND user_id = ?")
    .get(ruleId, userId);
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
    const updates: string[] = ["updated_at = ?"];
    const params: unknown[] = [new Date().toISOString()];
    if (name !== undefined) {
      updates.push("name = ?");
      params.push(name.trim());
    }
    if (hostId !== undefined) {
      updates.push("host_id = ?");
      params.push(hostId ?? null);
    }
    if (enabled !== undefined) {
      updates.push("enabled = ?");
      params.push(enabled ? 1 : 0);
    }
    if (triggerType !== undefined) {
      updates.push("trigger_type = ?");
      params.push(triggerType);
    }
    if (thresholdValue !== undefined) {
      updates.push("threshold_value = ?");
      params.push(thresholdValue ?? null);
    }
    if (thresholdDurationSeconds !== undefined) {
      updates.push("threshold_duration_seconds = ?");
      params.push(thresholdDurationSeconds ?? null);
    }
    if (cooldownMinutes !== undefined) {
      updates.push("cooldown_minutes = ?");
      params.push(cooldownMinutes);
    }
    params.push(ruleId, userId);

    getDb()
      .$client.prepare(
        `UPDATE alert_rules SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      )
      .run(...params);

    if (channels !== undefined) {
      getDb()
        .$client.prepare("DELETE FROM alert_rule_channels WHERE rule_id = ?")
        .run(ruleId);
      for (const channelId of channels) {
        const owned = getDb()
          .$client.prepare(
            "SELECT id FROM notification_channels WHERE id = ? AND user_id = ?",
          )
          .get(channelId, userId);
        if (!owned) continue;
        getDb()
          .$client.prepare(
            "INSERT OR IGNORE INTO alert_rule_channels (rule_id, channel_id) VALUES (?, ?)",
          )
          .run(ruleId, channelId);
      }
    }

    const row = getDb()
      .$client.prepare("SELECT * FROM alert_rules WHERE id = ?")
      .get(ruleId) as Record<string, unknown>;
    const linkedChannels = (
      getDb()
        .$client.prepare(
          "SELECT channel_id FROM alert_rule_channels WHERE rule_id = ?",
        )
        .all(ruleId) as Array<{ channel_id: number }>
    ).map((c) => c.channel_id);

    DatabaseSaveTrigger.triggerSave("alert_rule_updated");
    res.json({ ...row, channels: linkedChannels });
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
router.delete("/alert-rules/:id", (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const ruleId = Number(req.params.id);
  const existing = getDb()
    .$client.prepare("SELECT id FROM alert_rules WHERE id = ? AND user_id = ?")
    .get(ruleId, userId);
  if (!existing) return res.status(404).json({ error: "Alert rule not found" });
  getDb().$client.prepare("DELETE FROM alert_rules WHERE id = ?").run(ruleId);
  DatabaseSaveTrigger.triggerSave("alert_rule_deleted");
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
router.get("/alert-firings", (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const acknowledgedParam = req.query.acknowledged;

  try {
    let whereClause = "af.user_id = ?";
    const params: unknown[] = [userId];

    if (acknowledgedParam === "true") {
      whereClause += " AND af.acknowledged = 1";
    } else if (acknowledgedParam === "false") {
      whereClause += " AND af.acknowledged = 0";
    }

    const rows = getDb()
      .$client.prepare(
        `SELECT af.*, ar.name as rule_name
         FROM alert_firings af
         LEFT JOIN alert_rules ar ON ar.id = af.rule_id
         WHERE ${whereClause}
         ORDER BY af.fired_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    const total = (
      getDb()
        .$client.prepare(
          `SELECT COUNT(*) as c FROM alert_firings af WHERE ${whereClause}`,
        )
        .get(...params) as { c: number }
    ).c;

    res.json({ firings: rows, total });
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
router.post("/alert-firings/:id/acknowledge", (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const firingId = Number(req.params.id);
  getDb()
    .$client.prepare(
      "UPDATE alert_firings SET acknowledged = 1 WHERE id = ? AND user_id = ?",
    )
    .run(firingId, userId);
  DatabaseSaveTrigger.triggerSave("alert_firing_acknowledged");
  res.json({ success: true });
});

/**
 * @openapi
 * /alert-firings/acknowledge-all:
 *   post:
 *     summary: Acknowledge all alert firings for the current user
 *     tags:
 *       - Alerts
 */
router.post("/alert-firings/acknowledge-all", (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  getDb()
    .$client.prepare(
      "UPDATE alert_firings SET acknowledged = 1 WHERE user_id = ?",
    )
    .run(userId);
  DatabaseSaveTrigger.triggerSave("alert_firings_acknowledged_all");
  res.json({ success: true });
});

export default router;
