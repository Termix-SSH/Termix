import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  CONNECTION_STATES,
  type TunnelConnectRequest,
  type TunnelConnection,
} from "./types.js";
import type { TunnelManager } from "./manager.js";
import { errorMessage } from "./manager.js";
import type { PresetRecord, PresetRepository } from "./repository.js";
import {
  RESERVED_TUNNEL_NAME_PREFIX,
  isReservedTunnelName,
  validateTunnelConfig,
} from "./utils.js";
import { authorizeTunnelAction } from "./authorize.js";
import { buildTunnelConfig, resolveEndpoint } from "./config.js";

function actor(ctx: PluginContext): string {
  // Core's plugin router authenticates every request and runs it as that user.
  return ctx.currentActor() as string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parsePreset(row: PresetRecord) {
  let config: TunnelConnection[] = [];
  try {
    config = JSON.parse(row.config) as TunnelConnection[];
  } catch {
    config = [];
  }
  return { ...row, config };
}

/** Every item must be a client tunnel with a known mode and valid ports. */
export function validatePresetConfig(
  config: unknown,
): config is TunnelConnection[] {
  if (!Array.isArray(config)) return false;
  return config.every((item) => {
    if (!item || typeof item !== "object") return false;
    const tunnel = item as Partial<TunnelConnection>;
    const mode = tunnel.mode || tunnel.tunnelType;
    return (
      tunnel.scope === "c2s" &&
      (mode === "local" || mode === "remote" || mode === "dynamic") &&
      typeof tunnel.sourcePort === "number" &&
      tunnel.sourcePort >= 1 &&
      tunnel.sourcePort <= 65535 &&
      (mode === "dynamic" ||
        (typeof tunnel.endpointPort === "number" &&
          tunnel.endpointPort >= 1 &&
          tunnel.endpointPort <= 65535))
    );
  });
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Mounts the tunnel routes on the plugin's router, which core serves at
 * /plugin-api/tunnels with auth in front. Every route needs tunnels.use.
 */
export function registerTunnelRoutes(
  router: Router,
  ctx: PluginContext,
  manager: TunnelManager,
  presets: PresetRepository,
): void {
  router.use(ctx.rbac.require("use") as never);

  const statusClients = new Map<Response, string>();

  const sendSnapshot = (res: Response) => {
    const userId = statusClients.get(res);
    if (userId === undefined) return;
    void manager
      .statusesFor(userId)
      .then((snapshot) => {
        res.write(`event: statuses\ndata: ${JSON.stringify(snapshot)}\n\n`);
      })
      .catch(() => {
        statusClients.delete(res);
      });
  };

  const unsubscribe = manager.onChange(() => {
    for (const res of statusClients.keys()) sendSnapshot(res);
  });
  ctx.disposables.add(() => {
    unsubscribe();
    for (const res of statusClients.keys()) {
      try {
        res.end();
      } catch {
        // Already closed.
      }
    }
    statusClients.clear();
  });

  const canAccess = (userId: string) => (hostId: number) =>
    manager.canAccessHost(userId, hostId);

  /**
   * @openapi
   * /plugin-api/tunnels/status:
   *   get:
   *     summary: Get tunnel statuses
   *     description: Returns the status of every tunnel whose source host the caller can reach.
   *     tags:
   *       - Tunnels
   *     responses:
   *       200:
   *         description: Tunnel statuses keyed by tunnel name.
   *       403:
   *         description: Missing the tunnels.use permission.
   */
  router.get("/status", async (_req: Request, res: Response) => {
    res.json(await manager.statusesFor(actor(ctx)));
  });

  /**
   * @openapi
   * /plugin-api/tunnels/status/stream:
   *   get:
   *     summary: Stream tunnel statuses
   *     description: Server-sent events. Sends a "statuses" event with the full snapshot the caller can see on connect and after every change.
   *     tags:
   *       - Tunnels
   *     responses:
   *       200:
   *         description: An event stream.
   *       403:
   *         description: Missing the tunnels.use permission.
   */
  router.get("/status/stream", (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    statusClients.set(res, actor(ctx));
    sendSnapshot(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {
        closeStream();
      }
    }, 30_000);

    const closeStream = () => {
      clearInterval(heartbeat);
      statusClients.delete(res);
    };

    req.on("close", closeStream);
  });

  /**
   * @openapi
   * /plugin-api/tunnels/status/{tunnelName}:
   *   get:
   *     summary: Get one tunnel's status
   *     tags:
   *       - Tunnels
   *     parameters:
   *       - in: path
   *         name: tunnelName
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The tunnel's status.
   *       404:
   *         description: No such tunnel, or the caller cannot see it.
   */
  router.get("/status/:tunnelName", async (req: Request, res: Response) => {
    const tunnelName = String(req.params.tunnelName);
    // 404 rather than 403 for someone else's tunnel: the name itself carries
    // host details, so confirming it exists would leak them.
    if (!(await manager.canAccessTunnel(actor(ctx), tunnelName))) {
      return res.status(404).json({ error: "Tunnel not found" });
    }
    const status = manager.statuses.get(tunnelName);
    if (!status) return res.status(404).json({ error: "Tunnel not found" });
    res.json({ name: tunnelName, status });
  });

  /**
   * @openapi
   * /plugin-api/tunnels/connect:
   *   post:
   *     summary: Connect a tunnel
   *     description: Starts a server tunnel from one of the caller's hosts. Credentials are resolved on the server. The result arrives over the status stream.
   *     tags:
   *       - Tunnels
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               sourceHostId:
   *                 type: integer
   *               tunnelIndex:
   *                 type: integer
   *               mode:
   *                 type: string
   *               endpointHost:
   *                 type: string
   *               sourcePort:
   *                 type: integer
   *               endpointPort:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Connection request received.
   *       400:
   *         description: Invalid tunnel configuration.
   *       403:
   *         description: Access denied to this host.
   */
  router.post("/connect", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const body = (req.body ?? {}) as Partial<TunnelConnectRequest>;
    const tunnelName = body.name;

    if (!isNonEmptyString(tunnelName)) {
      return res.status(400).json({ error: "Invalid tunnel configuration" });
    }

    // Reserved for on-demand forwards, which skip retries by name. A saved
    // tunnel using it would silently lose its own reconnects.
    if (isReservedTunnelName(tunnelName)) {
      return res.status(400).json({
        error: `Tunnel names beginning with "${RESERVED_TUNNEL_NAME_PREFIX}" are reserved`,
      });
    }

    const sourceHostId = Number(body.sourceHostId);
    const tunnelIndex = Number(body.tunnelIndex ?? 0);
    if (!Number.isInteger(sourceHostId) || !Number.isInteger(tunnelIndex)) {
      return res.status(400).json({ error: "Invalid tunnel configuration" });
    }

    const request: TunnelConnectRequest = {
      ...(body as TunnelConnectRequest),
      endpointHost: (body.endpointHost ?? "").trim(),
      name: tunnelName,
      sourceHostId,
      tunnelIndex,
    };

    if (
      !validateTunnelConfig(tunnelName, {
        sourceHostId,
        tunnelIndex,
        sourcePort: request.sourcePort,
        endpointHost: request.endpointHost ?? "",
        endpointPort: request.endpointPort,
      })
    ) {
      return res
        .status(400)
        .json({ error: "Tunnel configuration does not match tunnel name" });
    }

    const access = await ctx.hosts.checkAccess(sourceHostId, "connect");
    const host = access.hasAccess ? await ctx.hosts.get(sourceHostId) : null;
    if (!host) {
      ctx.log.warn(
        `User ${userId} tried to connect tunnel ${tunnelName} without access to host ${sourceHostId}`,
      );
      return res.status(403).json({ error: "Access denied to this host" });
    }

    try {
      const config = await resolveEndpoint(
        ctx,
        buildTunnelConfig(host, request, userId),
      );
      await manager.start(config);
    } catch (error) {
      const reason = errorMessage(error);
      ctx.log.warn(`Tunnel ${tunnelName} could not start: ${reason}`);
      manager.broadcast(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.FAILED,
        reason,
      });
    }

    res.json({ message: "Connection request received", tunnelName });
  });

  const stopHandler =
    (message: string) => async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const tunnelName = (req.body ?? {}).tunnelName;
      if (!isNonEmptyString(tunnelName)) {
        return res.status(400).json({ error: "Tunnel name required" });
      }

      const decision = await authorizeTunnelAction(
        canAccess(userId),
        tunnelName,
        manager.configs.get(tunnelName),
      );
      if (!decision.allowed) {
        return res.status(403).json({ error: "Access denied" });
      }

      await manager.stop(tunnelName);
      res.json({ message, tunnelName });
    };

  /**
   * @openapi
   * /plugin-api/tunnels/disconnect:
   *   post:
   *     summary: Disconnect a tunnel
   *     tags:
   *       - Tunnels
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               tunnelName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Disconnect request received.
   *       400:
   *         description: Tunnel name required.
   *       403:
   *         description: Access denied.
   */
  router.post("/disconnect", stopHandler("Disconnect request received"));

  /**
   * @openapi
   * /plugin-api/tunnels/cancel:
   *   post:
   *     summary: Cancel a tunnel's connect or retry
   *     tags:
   *       - Tunnels
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               tunnelName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Cancel request received.
   *       400:
   *         description: Tunnel name required.
   *       403:
   *         description: Access denied.
   */
  router.post("/cancel", stopHandler("Cancel request received"));

  /**
   * @openapi
   * /plugin-api/tunnels/presets:
   *   get:
   *     summary: List client tunnel presets
   *     description: Returns the caller's saved client-to-server tunnel presets.
   *     tags:
   *       - Tunnels
   *     responses:
   *       200:
   *         description: List of tunnel presets.
   *       403:
   *         description: Missing the tunnels.use permission.
   */
  router.get("/presets", async (_req: Request, res: Response) => {
    try {
      const rows = await presets.listByUserId(actor(ctx));
      res.json(rows.map(parsePreset));
    } catch (error) {
      ctx.log.error(
        "Failed to fetch client tunnel presets",
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: "Failed to fetch C2S tunnel presets" });
    }
  });

  /**
   * @openapi
   * /plugin-api/tunnels/presets:
   *   post:
   *     summary: Create a client tunnel preset
   *     tags:
   *       - Tunnels
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               config:
   *                 type: array
   *                 items:
   *                   type: object
   *               platform:
   *                 type: string
   *               computerName:
   *                 type: string
   *     responses:
   *       201:
   *         description: Preset created.
   *       400:
   *         description: Invalid name or config.
   *       409:
   *         description: A preset with that name already exists.
   */
  router.post("/presets", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const { name, config, platform, computerName } = req.body ?? {};

    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: "Preset name is required" });
    }
    if (!validatePresetConfig(config)) {
      return res
        .status(400)
        .json({ error: "Invalid C2S tunnel configuration" });
    }

    const trimmedName = name.trim();
    try {
      if (await presets.hasNameForUser(userId, trimmedName)) {
        return res.status(409).json({ error: "Preset name already exists" });
      }
      const created = await presets.createForUser(userId, {
        name: trimmedName,
        config: JSON.stringify(config),
        platform: trimmedOrNull(platform),
        computerName: trimmedOrNull(computerName),
      });
      res.status(201).json(parsePreset(created));
    } catch (error) {
      ctx.log.error(
        "Failed to create client tunnel preset",
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: "Failed to create C2S tunnel preset" });
    }
  });

  /**
   * @openapi
   * /plugin-api/tunnels/presets/{id}:
   *   put:
   *     summary: Update a client tunnel preset
   *     tags:
   *       - Tunnels
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Preset updated.
   *       400:
   *         description: Invalid name or config.
   *       404:
   *         description: Preset not found.
   *       409:
   *         description: A preset with that name already exists.
   */
  router.put("/presets/:id", async (req: Request, res: Response) => {
    const userId = actor(ctx);
    const id = Number(req.params.id);
    const { name, config, platform, computerName } = req.body ?? {};

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const existing = await presets.findByIdForUser(userId, id);
      if (!existing) return res.status(404).json({ error: "Preset not found" });

      const updates: Parameters<PresetRepository["updateForUser"]>[2] = {};

      if (name !== undefined) {
        if (!isNonEmptyString(name)) {
          return res.status(400).json({ error: "Preset name is required" });
        }
        const trimmedName = name.trim();
        if (await presets.hasNameForUser(userId, trimmedName, id)) {
          return res.status(409).json({ error: "Preset name already exists" });
        }
        updates.name = trimmedName;
      }

      if (config !== undefined) {
        if (!validatePresetConfig(config)) {
          return res
            .status(400)
            .json({ error: "Invalid C2S tunnel configuration" });
        }
        updates.config = JSON.stringify(config);
      }
      if (platform !== undefined) updates.platform = trimmedOrNull(platform);
      if (computerName !== undefined) {
        updates.computerName = trimmedOrNull(computerName);
      }

      const updated = await presets.updateForUser(userId, id, updates);
      res.json(parsePreset(updated ?? existing));
    } catch (error) {
      ctx.log.error(
        "Failed to update client tunnel preset",
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: "Failed to update C2S tunnel preset" });
    }
  });

  /**
   * @openapi
   * /plugin-api/tunnels/presets/{id}:
   *   delete:
   *     summary: Delete a client tunnel preset
   *     tags:
   *       - Tunnels
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Preset deleted.
   *       404:
   *         description: Preset not found.
   */
  router.delete("/presets/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      if (!(await presets.deleteForUser(actor(ctx), id))) {
        return res.status(404).json({ error: "Preset not found" });
      }
      res.json({ success: true });
    } catch (error) {
      ctx.log.error(
        "Failed to delete client tunnel preset",
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: "Failed to delete C2S tunnel preset" });
    }
  });
}
