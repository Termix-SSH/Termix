import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { createCurrentNotificationChannelRepository } from "../repositories/factory.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { sendWebhook, sendNtfy } from "../../utils/notification-sender.js";
import { sendDiscord } from "../../utils/discord-sender.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

router.use(authenticateJWT);

/**
 * @openapi
 * /notification-channels:
 *   get:
 *     summary: List notification channels for the current user
 *     tags:
 *       - Notifications
 *     responses:
 *       200:
 *         description: List of notification channels.
 */
router.get("/notification-channels", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows =
      await createCurrentNotificationChannelRepository().listNotificationChannels(
        userId,
      );
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
 *       - Notifications
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
  if (type !== "webhook" && type !== "ntfy" && type !== "discord") {
    return res
      .status(400)
      .json({ error: "type must be 'webhook', 'ntfy' or 'discord'" });
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
  if (type === "discord") {
    const c = config as Record<string, unknown>;
    if (!c.url || typeof c.url !== "string")
      return res.status(400).json({ error: "discord config requires url" });
    if (
      !/^https:\/\/(?:canary\.|ptb\.)?(?:discord\.com|discordapp\.com)\/api\/webhooks\/.+/i.test(
        c.url,
      )
    ) {
      return res.status(400).json({
        error:
          "discord config requires a valid Discord webhook URL (https://discord.com/api/webhooks/...)",
      });
    }
  }

  try {
    const row =
      await createCurrentNotificationChannelRepository().createNotificationChannel(
        {
          userId,
          name: name.trim(),
          type,
          config: JSON.stringify(config),
          enabled: enabled !== false,
        },
      );
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
 *       - Notifications
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

    const repository = createCurrentNotificationChannelRepository();
    const existing = await repository.findNotificationChannelForUser(
      channelId,
      userId,
    );
    if (!existing) return res.status(404).json({ error: "Channel not found" });

    if (type && type !== "webhook" && type !== "ntfy" && type !== "discord") {
      return res
        .status(400)
        .json({ error: "type must be 'webhook', 'ntfy' or 'discord'" });
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
 *       - Notifications
 */
router.delete(
  "/notification-channels/:id",
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const channelId = Number(req.params.id);
    const deleted =
      await createCurrentNotificationChannelRepository().deleteNotificationChannel(
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
 *       - Notifications
 */
router.post(
  "/notification-channels/:id/test",
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const channelId = Number(req.params.id);
    const row =
      await createCurrentNotificationChannelRepository().findNotificationChannelForUser(
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
      } else if (row.type === "discord") {
        await sendDiscord(
          config as unknown as Parameters<typeof sendDiscord>[0],
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

export default router;
