import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  CHANNEL_TYPES,
  isSeverity,
  type AlertRule,
  type ChannelType,
} from "../types.js";
import type { Announcements } from "./announcements.js";
import { deliverToChannels } from "./hub.js";
import type { AlertsRepository } from "./repository.js";
import { validateChannelConfig, type SenderDeps } from "./senders.js";
import type { AlertStream } from "./stream.js";

interface RouteDeps {
  ctx: PluginContext;
  repository: AlertsRepository;
  stream: AlertStream;
  senders: SenderDeps;
  announcements: Announcements;
}

function actor(ctx: PluginContext): string {
  // Core's plugin router authenticates every request and runs it as that user.
  return ctx.currentActor() as string;
}

function positiveInt(value: unknown): number | null {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isChannelType(value: unknown): value is ChannelType {
  return (CHANNEL_TYPES as readonly string[]).includes(String(value));
}

function idList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(positiveInt).filter((id): id is number => id !== null)
    : [];
}

export function registerRoutes(router: Router, deps: RouteDeps): void {
  const { ctx, repository, stream, senders, announcements } = deps;

  router.use(ctx.rbac.require("use") as never);

  const publishUnread = async (userId: string) => {
    stream.publish(userId, "unread", {
      count: await repository.unreadCount(userId),
    });
  };

  /**
   * @openapi
   * /plugin-api/alerts/items:
   *   get:
   *     summary: List the caller's alerts
   *     description: Newest first. Brings in any Termix announcement the caller has not seen yet.
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: query
   *         name: unread
   *         schema:
   *           type: boolean
   *       - in: query
   *         name: source
   *         schema:
   *           type: string
   *       - in: query
   *         name: severity
   *         schema:
   *           type: string
   *           enum: [info, success, warning, critical]
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *       - in: query
   *         name: before
   *         description: Only alerts with a lower id, for paging.
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The alerts and the unread count.
   *       403:
   *         description: Missing the alerts.use permission.
   */
  router.get("/items", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    await announcements.sync(userId);
    const severity = isSeverity(req.query.severity)
      ? req.query.severity
      : undefined;
    const items = await repository.listItems(userId, {
      unread: req.query.unread === "true",
      source: typeof req.query.source === "string" ? req.query.source : "",
      severity,
      limit: positiveInt(req.query.limit) ?? 50,
      beforeId: positiveInt(req.query.before) ?? undefined,
    });
    res.json({ items, unread: await repository.unreadCount(userId) });
  });

  /**
   * @openapi
   * /plugin-api/alerts/unread:
   *   get:
   *     summary: Count the caller's unread alerts
   *     tags:
   *       - Alerts
   *     responses:
   *       200:
   *         description: The unread count.
   */
  router.get("/unread", async (_req: Request, res: Response) => {
    const userId = actor(ctx);
    await announcements.sync(userId);
    res.json({ count: await repository.unreadCount(userId) });
  });

  /**
   * @openapi
   * /plugin-api/alerts/stream:
   *   get:
   *     summary: Stream new alerts
   *     description: Server-sent events. Sends "unread" with the count on connect and after every change, and "item" with each new or updated alert.
   *     tags:
   *       - Alerts
   *     responses:
   *       200:
   *         description: An event stream.
   */
  router.get("/stream", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    await announcements.sync(userId);
    stream.open(req, res, userId, {
      count: await repository.unreadCount(userId),
    });
  });

  /**
   * @openapi
   * /plugin-api/alerts/items/read:
   *   post:
   *     summary: Mark alerts read or unread
   *     tags:
   *       - Alerts
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               ids:
   *                 type: array
   *                 items:
   *                   type: integer
   *               all:
   *                 type: boolean
   *               read:
   *                 type: boolean
   *                 description: False marks them unread. Defaults to true.
   *     responses:
   *       200:
   *         description: The new unread count.
   */
  router.post("/items/read", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const read = body.read !== false;
    await repository.setRead(
      userId,
      body.all === true ? "all" : idList(body.ids),
      read,
    );
    await publishUnread(userId);
    res.json({ count: await repository.unreadCount(userId) });
  });

  /**
   * @openapi
   * /plugin-api/alerts/items/{id}:
   *   delete:
   *     summary: Delete an alert
   *     description: A deleted Termix announcement does not come back.
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Deleted.
   *       404:
   *         description: No such alert for the caller.
   */
  router.delete("/items/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = positiveInt(req.params.id);
    const item = id ? await repository.deleteItem(userId, id) : null;
    if (!item) return res.status(404).json({ error: "Alert not found" });
    await announcements.forget(userId, item);
    await publishUnread(userId);
    res.json({ success: true });
  });

  /**
   * @openapi
   * /plugin-api/alerts/items:
   *   delete:
   *     summary: Clear the caller's alerts
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: query
   *         name: read
   *         description: Only clear alerts already read.
   *         schema:
   *           type: boolean
   *     responses:
   *       200:
   *         description: How many alerts were removed.
   */
  router.delete("/items", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const removed = await repository.clearItems(
      userId,
      req.query.read === "true",
    );
    for (const item of removed) await announcements.forget(userId, item);
    await publishUnread(userId);
    res.json({ removed: removed.length });
  });

  /**
   * @openapi
   * /plugin-api/alerts/categories:
   *   get:
   *     summary: List the sources and categories of the caller's alerts
   *     description: For building delivery rules.
   *     tags:
   *       - Alerts
   *     responses:
   *       200:
   *         description: Source and category pairs.
   */
  router.get("/categories", async (_req: Request, res: Response) => {
    res.json(await repository.listCategories(actor(ctx)));
  });

  /**
   * @openapi
   * /plugin-api/alerts/meta:
   *   get:
   *     summary: What channel types this server can use
   *     tags:
   *       - Alerts
   *     responses:
   *       200:
   *         description: The channel types and whether email is set up.
   */
  router.get("/meta", async (_req: Request, res: Response) => {
    res.json({
      emailAvailable: (await senders.smtp()) !== null,
      channelTypes: CHANNEL_TYPES,
    });
  });

  /**
   * @openapi
   * /plugin-api/alerts/channels:
   *   get:
   *     summary: List the caller's channels
   *     description: Without their config.
   *     tags:
   *       - Alerts
   *     responses:
   *       200:
   *         description: The channels.
   */
  router.get("/channels", async (_req: Request, res: Response) => {
    res.json(await repository.listChannels(actor(ctx)));
  });

  /**
   * @openapi
   * /plugin-api/alerts/channels/{id}:
   *   get:
   *     summary: Get one of the caller's channels with its config
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The channel.
   *       404:
   *         description: No such channel for the caller.
   */
  router.get("/channels/:id", async (req: Request, res: Response) => {
    const id = positiveInt(req.params.id);
    const channel = id ? await repository.getChannel(actor(ctx), id) : null;
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    res.json(channel);
  });

  const readChannel = (
    body: Record<string, unknown>,
    partial: boolean,
  ):
    | { error: string }
    | {
        name?: string;
        type?: ChannelType;
        config?: Record<string, unknown>;
        enabled?: boolean;
      } => {
    const out: {
      name?: string;
      type?: ChannelType;
      config?: Record<string, unknown>;
      enabled?: boolean;
    } = {};
    if (body.name !== undefined || !partial) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return { error: "name is required" };
      out.name = name.slice(0, 100);
    }
    if (body.type !== undefined || !partial) {
      if (!isChannelType(body.type)) {
        return { error: `type must be one of ${CHANNEL_TYPES.join(", ")}` };
      }
      out.type = body.type;
    }
    if (body.config !== undefined || !partial) {
      if (
        !body.config ||
        typeof body.config !== "object" ||
        Array.isArray(body.config)
      ) {
        return { error: "config is required" };
      }
      out.config = body.config as Record<string, unknown>;
    }
    if (body.enabled !== undefined) out.enabled = body.enabled !== false;
    return out;
  };

  /**
   * @openapi
   * /plugin-api/alerts/channels:
   *   post:
   *     summary: Create a channel
   *     tags:
   *       - Alerts
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, type, config]
   *             properties:
   *               name:
   *                 type: string
   *               type:
   *                 type: string
   *                 enum: [webhook, ntfy, discord, email]
   *               config:
   *                 type: object
   *               enabled:
   *                 type: boolean
   *     responses:
   *       201:
   *         description: The new channel.
   *       400:
   *         description: The channel is not valid.
   */
  router.post("/channels", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const input = readChannel(
      (req.body ?? {}) as Record<string, unknown>,
      false,
    );
    if ("error" in input) return res.status(400).json(input);
    const problem = validateChannelConfig(input.type!, input.config!);
    if (problem) return res.status(400).json({ error: problem });
    const id = await repository.createChannel(userId, {
      name: input.name!,
      type: input.type!,
      config: input.config!,
      enabled: input.enabled,
    });
    res.status(201).json(await repository.getChannel(userId, id));
  });

  /**
   * @openapi
   * /plugin-api/alerts/channels/{id}:
   *   put:
   *     summary: Update a channel
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               type:
   *                 type: string
   *                 enum: [webhook, ntfy, discord, email]
   *               config:
   *                 type: object
   *               enabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: The updated channel.
   *       400:
   *         description: The channel is not valid.
   *       404:
   *         description: No such channel for the caller.
   */
  router.put("/channels/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = positiveInt(req.params.id);
    const existing = id ? await repository.getChannel(userId, id) : null;
    if (!id || !existing) {
      return res.status(404).json({ error: "Channel not found" });
    }
    const input = readChannel(
      (req.body ?? {}) as Record<string, unknown>,
      true,
    );
    if ("error" in input) return res.status(400).json(input);
    const type = input.type ?? existing.type;
    if (input.config !== undefined || input.type !== undefined) {
      const problem = validateChannelConfig(
        type,
        input.config ?? existing.config,
      );
      if (problem) return res.status(400).json({ error: problem });
    }
    await repository.updateChannel(userId, id, input);
    res.json(await repository.getChannel(userId, id));
  });

  /**
   * @openapi
   * /plugin-api/alerts/channels/{id}:
   *   delete:
   *     summary: Delete a channel
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Deleted.
   *       404:
   *         description: No such channel for the caller.
   */
  router.delete("/channels/:id", async (req: Request, res: Response) => {
    const id = positiveInt(req.params.id);
    const deleted = id ? await repository.deleteChannel(actor(ctx), id) : false;
    if (!deleted) return res.status(404).json({ error: "Channel not found" });
    res.json({ success: true });
  });

  /**
   * @openapi
   * /plugin-api/alerts/channels/{id}/test:
   *   post:
   *     summary: Send a test alert to a channel
   *     description: Takes the same path a real alert does, private network opt-in included.
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Whether the channel accepted it, with the error when it did not.
   *       404:
   *         description: No such channel for the caller.
   */
  router.post("/channels/:id/test", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = positiveInt(req.params.id);
    const channel = id
      ? (await repository.deliverableChannels(userId)).find(
          (candidate) => candidate.id === id,
        )
      : undefined;
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    const [result] = await deliverToChannels(
      [channel],
      {
        title: "Termix",
        body: "This is a test alert from Termix.",
        severity: "info",
        category: "alerts.test",
        source: ctx.pluginId,
        context: { sourceName: "Test", triggerType: "test" },
      },
      senders,
    );
    res.json(
      result.ok ? { success: true } : { success: false, error: result.error },
    );
  });

  const readRule = async (
    userId: string,
    body: Record<string, unknown>,
  ): Promise<{ error: string } | Omit<AlertRule, "id">> => {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { error: "name is required" };
    const match =
      typeof body.match === "string" && body.match.trim()
        ? body.match.trim().slice(0, 128)
        : "*";
    const minSeverity = isSeverity(body.minSeverity)
      ? body.minSeverity
      : "warning";
    const owned = new Set(
      (await repository.listChannels(userId)).map((channel) => channel.id),
    );
    const channelIds = [...new Set(idList(body.channelIds))];
    if (channelIds.length === 0) {
      return { error: "Pick at least one channel" };
    }
    if (channelIds.some((id) => !owned.has(id))) {
      return { error: "Unknown channel" };
    }
    return {
      name: name.slice(0, 100),
      match,
      minSeverity,
      channelIds,
      enabled: body.enabled !== false,
    };
  };

  /**
   * @openapi
   * /plugin-api/alerts/rules:
   *   get:
   *     summary: List the caller's delivery rules
   *     tags:
   *       - Alerts
   *     responses:
   *       200:
   *         description: The rules.
   */
  router.get("/rules", async (_req: Request, res: Response) => {
    res.json(await repository.listRules(actor(ctx)));
  });

  /**
   * @openapi
   * /plugin-api/alerts/rules:
   *   post:
   *     summary: Create a delivery rule
   *     description: Sends every alert whose category matches and whose severity is at least minSeverity to the listed channels.
   *     tags:
   *       - Alerts
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, channelIds]
   *             properties:
   *               name:
   *                 type: string
   *               match:
   *                 type: string
   *                 description: '"*", "automations.*" or an exact category.'
   *               minSeverity:
   *                 type: string
   *                 enum: [info, success, warning, critical]
   *               channelIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *               enabled:
   *                 type: boolean
   *     responses:
   *       201:
   *         description: The new rule.
   *       400:
   *         description: The rule is not valid.
   */
  router.post("/rules", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const input = await readRule(
      userId,
      (req.body ?? {}) as Record<string, unknown>,
    );
    if ("error" in input) return res.status(400).json(input);
    const id = await repository.createRule(userId, input);
    res.status(201).json({ id, ...input });
  });

  /**
   * @openapi
   * /plugin-api/alerts/rules/{id}:
   *   put:
   *     summary: Update a delivery rule
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The updated rule.
   *       400:
   *         description: The rule is not valid.
   *       404:
   *         description: No such rule for the caller.
   */
  router.put("/rules/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = positiveInt(req.params.id);
    if (!id) return res.status(404).json({ error: "Rule not found" });
    const input = await readRule(
      userId,
      (req.body ?? {}) as Record<string, unknown>,
    );
    if ("error" in input) return res.status(400).json(input);
    if (!(await repository.updateRule(userId, id, input))) {
      return res.status(404).json({ error: "Rule not found" });
    }
    res.json({ id, ...input });
  });

  /**
   * @openapi
   * /plugin-api/alerts/rules/{id}:
   *   delete:
   *     summary: Delete a delivery rule
   *     tags:
   *       - Alerts
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Deleted.
   *       404:
   *         description: No such rule for the caller.
   */
  router.delete("/rules/:id", async (req: Request, res: Response) => {
    const id = positiveInt(req.params.id);
    const deleted = id ? await repository.deleteRule(actor(ctx), id) : false;
    if (!deleted) return res.status(404).json({ error: "Rule not found" });
    res.json({ success: true });
  });
}
