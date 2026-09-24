import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router,
} from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  defaultLayoutFromWidgets,
  deriveEnabledWidgets,
  type HostMetricsLayout,
} from "../shared/host-metrics.js";
import { newSessionId, supportsMetrics } from "./helpers.js";
import {
  startInteractive,
  submitTotp,
  type InteractiveDeps,
} from "./interactive.js";
import type { MetricsLogger } from "./log.js";
import { registerManagerRoutes } from "./managers/index.js";
import { AccessDeniedError } from "./managers/route-helpers.js";
import type { HealthCheckEvent } from "./managers/types.js";
import type { MetricsPoller } from "./poller.js";
import { sqlTimestamp, type HostMetricsRepository } from "./repository.js";
import { sessionKey, type MetricsSessions } from "./sessions.js";
import { sudoPasswordOf } from "./helpers.js";

export interface RouteDeps {
  ctx: PluginContext;
  log: MetricsLogger;
  poller: MetricsPoller;
  sessions: MetricsSessions;
  repository: HostMetricsRepository;
  onHealthCheck: (event: HealthCheckEvent) => void;
}

const RANGE_OFFSETS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function validateHostId(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.params.id);
  if (!id || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid host ID" });
  }
  next();
}

export function sanitizeLayout(input: unknown): HostMetricsLayout | null {
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

/** Everything under /plugin-api/host-metrics. Core authenticates first. */
export function registerRoutes(router: Router, deps: RouteDeps): void {
  const { ctx, log, poller, sessions, repository } = deps;

  router.use(ctx.rbac.require("use") as unknown as RequestHandler);
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const actor = (res: Response): string | null => {
    const userId = ctx.currentActor();
    if (!userId) res.status(401).json({ error: "Authentication required" });
    return userId ?? null;
  };

  const canConnect = async (hostId: number) =>
    (await ctx.hosts.checkAccess(hostId, "connect")).hasAccess;

  const interactive: InteractiveDeps = {
    ssh: ctx.ssh,
    sessions,
    log,
    registerViewer: (hostId, sessionId, userId) =>
      poller.registerViewer(hostId, sessionId, userId),
  };

  /**
   * @openapi
   * /plugin-api/host-metrics/defaults:
   *   get:
   *     summary: Get defaults for new hosts
   *     description: Whether a new host starts with metrics on, an admin setting any user creating a host needs.
   *     tags:
   *       - Host Metrics
   *     responses:
   *       200:
   *         description: The defaults.
   */
  router.get("/defaults", async (_req, res) => {
    res.json({
      enabledForNewHosts:
        (await ctx.settings.get<boolean>("enabledForNewHosts")) !== false,
    });
  });

  /**
   * @openapi
   * /plugin-api/host-metrics/metrics/{id}:
   *   get:
   *     summary: Get host metrics
   *     description: Returns the latest sample for a host, including CPU, memory, disk, network, processes and system information.
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
   *         description: Host metrics data.
   *       403:
   *         description: No access to this host.
   *       404:
   *         description: Metrics not available.
   */
  router.get("/metrics/:id", validateHostId, async (req, res) => {
    const id = Number(req.params.id);
    if (!actor(res)) return;
    if (!(await canConnect(id))) {
      return res.status(403).json({ error: "No access to this host" });
    }
    const sample = poller.getMetrics(id);
    if (!sample) {
      return res.status(404).json({
        error: "Metrics not available",
        cpu: { percent: null, cores: null, load: null },
        memory: { percent: null, usedGiB: null, totalGiB: null },
        disk: {
          percent: null,
          usedHuman: null,
          totalHuman: null,
          availableHuman: null,
          mount: null,
          filesystems: [],
        },
        network: { interfaces: [] },
        uptime: { seconds: null, formatted: null },
        processes: { total: null, running: null, top: [] },
        system: { hostname: null, kernel: null, os: null },
        lastChecked: new Date().toISOString(),
      });
    }
    res.json({
      ...sample.data,
      lastChecked: new Date(sample.timestamp).toISOString(),
    });
  });

  /**
   * @openapi
   * /plugin-api/host-metrics/metrics/start/{id}:
   *   post:
   *     summary: Start metrics collection
   *     description: Opens an SSH connection from the tab, where a TOTP prompt can be answered, and starts collecting metrics for the host.
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
   *         description: Metrics collection started, or a TOTP code is required.
   *       401:
   *         description: The host needs a sign-in step first.
   *       404:
   *         description: Host not found.
   *       500:
   *         description: Failed to start metrics collection.
   */
  router.post("/metrics/start/:id", validateHostId, async (req, res) => {
    const id = Number(req.params.id);
    const userId = actor(res);
    if (!userId) return;
    try {
      const host = await poller.resolve(id, userId);
      if (!host) {
        return res.status(404).json({
          error: "Host not found",
          connectionLogs: [
            {
              type: "error",
              stage: "stats_connecting",
              message: "Host not found",
            },
          ],
        });
      }
      const result = await startInteractive(interactive, host, userId);
      res.status(result.status).json(result.body);
    } catch (error) {
      log.error("Failed to start metrics collection", error, {
        operation: "metrics_start_error",
        hostId: id,
      });
      res.status(500).json({ error: "Failed to start metrics collection" });
    }
  });

  /**
   * @openapi
   * /plugin-api/host-metrics/metrics/stop/{id}:
   *   post:
   *     summary: Stop metrics collection
   *     description: Closes the tab's connection and drops its viewer, which stops polling when it was the last one.
   *     tags:
   *       - Host Metrics
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
   *               viewerSessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Metrics collection stopped.
   */
  router.post("/metrics/stop/:id", validateHostId, async (req, res) => {
    const id = Number(req.params.id);
    const userId = actor(res);
    if (!userId) return;
    sessions.close(sessionKey(id, userId));
    const { viewerSessionId } = (req.body ?? {}) as {
      viewerSessionId?: unknown;
    };
    if (typeof viewerSessionId === "string" && viewerSessionId) {
      poller.unregisterViewer(id, viewerSessionId, userId);
    } else if (await canConnect(id)) {
      poller.pause(id);
    }
    res.json({ success: true });
  });

  /**
   * @openapi
   * /plugin-api/host-metrics/metrics/connect-totp:
   *   post:
   *     summary: Submit a TOTP code
   *     description: Answers the TOTP prompt a metrics connection is waiting on.
   *     tags:
   *       - Host Metrics
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *               totpCode:
   *                 type: string
   *     responses:
   *       200:
   *         description: Connected.
   *       400:
   *         description: Missing sessionId or totpCode.
   *       401:
   *         description: TOTP verification failed.
   *       404:
   *         description: TOTP session not found or expired.
   *       429:
   *         description: Too many TOTP attempts.
   */
  router.post("/metrics/connect-totp", async (req, res) => {
    const userId = actor(res);
    if (!userId) return;
    const { sessionId, totpCode } = (req.body ?? {}) as {
      sessionId?: unknown;
      totpCode?: unknown;
    };
    if (typeof sessionId !== "string" || typeof totpCode !== "string") {
      return res.status(400).json({ error: "Missing sessionId or totpCode" });
    }
    const result = await submitTotp(interactive, userId, sessionId, totpCode);
    res.status(result.status).json(result.body);
  });

  /**
   * @openapi
   * /plugin-api/host-metrics/metrics/heartbeat:
   *   post:
   *     summary: Keep a metrics viewer alive
   *     description: A viewer without a heartbeat for two minutes is dropped.
   *     tags:
   *       - Host Metrics
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               viewerSessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Heartbeat updated.
   *       400:
   *         description: Invalid viewerSessionId.
   *       404:
   *         description: Viewer session not found.
   */
  router.post("/metrics/heartbeat", (req, res) => {
    const userId = actor(res);
    if (!userId) return;
    const { viewerSessionId } = (req.body ?? {}) as {
      viewerSessionId?: unknown;
    };
    if (typeof viewerSessionId !== "string" || !viewerSessionId) {
      return res.status(400).json({ error: "Invalid viewerSessionId" });
    }
    if (poller.updateHeartbeat(viewerSessionId, userId)) {
      return res.json({ success: true });
    }
    res.status(404).json({ error: "Viewer session not found" });
  });

  /**
   * @openapi
   * /plugin-api/host-metrics/metrics/register-viewer:
   *   post:
   *     summary: Register a metrics viewer
   *     description: Starts polling a host while something shows its metrics. Answers skipped instead of failing when the host has no metrics.
   *     tags:
   *       - Host Metrics
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Viewer registered, or skipped with a reason.
   *       400:
   *         description: Invalid hostId.
   */
  router.post("/metrics/register-viewer", async (req, res) => {
    const userId = actor(res);
    if (!userId) return;
    const { hostId } = (req.body ?? {}) as { hostId?: unknown };
    if (
      typeof hostId !== "number" ||
      !Number.isInteger(hostId) ||
      hostId <= 0
    ) {
      return res.status(400).json({ error: "Invalid hostId" });
    }
    const skipped = (reason: string) =>
      res.json({ success: true, skipped: true, reason });
    try {
      const host = await poller.resolve(hostId, userId);
      if (!host) return skipped("host_not_found");
      if (!supportsMetrics(host, ctx.ssh))
        return skipped("metrics_unsupported");
      if (!(await poller.settingsFor(hostId)).metricsEnabled) {
        return skipped("metrics_disabled");
      }
      const viewerSessionId = newSessionId("viewer");
      poller.registerViewer(hostId, viewerSessionId, userId);
      res.json({ success: true, viewerSessionId });
    } catch (error) {
      log.warn("Failed to register viewer", {
        operation: "register_viewer_error",
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.json({ success: false, skipped: true, reason: "internal_error" });
    }
  });

  /**
   * @openapi
   * /plugin-api/host-metrics/metrics/unregister-viewer:
   *   post:
   *     summary: Unregister a metrics viewer
   *     description: Drops a viewer. Polling stops with the last one.
   *     tags:
   *       - Host Metrics
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *               viewerSessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Viewer unregistered.
   *       400:
   *         description: Invalid hostId or viewerSessionId.
   */
  router.post("/metrics/unregister-viewer", (req, res) => {
    const userId = actor(res);
    if (!userId) return;
    const { hostId, viewerSessionId } = (req.body ?? {}) as {
      hostId?: unknown;
      viewerSessionId?: unknown;
    };
    if (typeof hostId !== "number" || !hostId) {
      return res.status(400).json({ error: "Invalid hostId" });
    }
    if (typeof viewerSessionId !== "string" || !viewerSessionId) {
      return res.status(400).json({ error: "Invalid viewerSessionId" });
    }
    poller.unregisterViewer(hostId, viewerSessionId, userId);
    res.json({ success: true });
  });

  /**
   * @openapi
   * /plugin-api/host-metrics/metrics/history/{id}:
   *   get:
   *     summary: Get metrics history
   *     description: Returns stored CPU, memory, disk and network samples for a host over a range.
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
   *       - in: query
   *         name: to
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The samples in the range.
   *       400:
   *         description: Invalid range or dates.
   *       403:
   *         description: No access to this host.
   */
  router.get("/metrics/history/:id", validateHostId, async (req, res) => {
    const hostId = Number(req.params.id);
    if (!actor(res)) return;
    try {
      if (!(await canConnect(hostId))) {
        return res.status(403).json({ error: "Access denied" });
      }
      const { range, from, to } = req.query as Record<
        string,
        string | undefined
      >;
      let fromDate: Date;
      let toDate = new Date();
      if (range) {
        const offsetMs = RANGE_OFFSETS[range];
        if (!offsetMs) {
          return res
            .status(400)
            .json({ error: "Invalid range. Use 1h, 6h, 24h, 7d, or 30d" });
        }
        fromDate = new Date(Date.now() - offsetMs);
      } else if (from && to) {
        fromDate = new Date(from);
        toDate = new Date(to);
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          return res.status(400).json({ error: "Invalid from/to date format" });
        }
      } else {
        fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }

      const rows = (
        await repository.listSamples(
          hostId,
          sqlTimestamp(fromDate),
          sqlTimestamp(toDate),
        )
      ).map((row) => ({
        ts: row.ts,
        cpu_percent: row.cpuPercent,
        mem_percent: row.memPercent,
        disk_percent: row.diskPercent,
        net_rx_bytes: row.netRxBytes,
        net_tx_bytes: row.netTxBytes,
      }));
      res.json({
        rows,
        fromTs: fromDate.toISOString(),
        toTs: toDate.toISOString(),
      });
    } catch (error) {
      log.error("Failed to fetch metrics history", error, {
        operation: "metrics_history_fetch_error",
        hostId,
      });
      res.status(500).json({ error: "Failed to fetch metrics history" });
    }
  });

  /**
   * @openapi
   * /plugin-api/host-metrics/host-metrics/preferences/{id}:
   *   get:
   *     summary: Get the Host Metrics layout for a host
   *     description: Returns the current user's saved card layout for the host, or a default layout from the host's enabled widgets when none is saved.
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
   */
  router.get(
    "/host-metrics/preferences/:id",
    validateHostId,
    async (req, res) => {
      const userId = actor(res);
      if (!userId) return;
      const hostId = Number(req.params.id);
      try {
        if (!(await canConnect(hostId))) {
          return res.status(403).json({ error: "No access to this host" });
        }
        const saved = await repository.findLayout(userId, hostId);
        if (saved) {
          try {
            const parsed = sanitizeLayout(JSON.parse(saved));
            if (parsed) return res.json({ layout: parsed });
          } catch {
            // fall through to the default
          }
        }
        const settings = await poller.settingsFor(hostId);
        res.json({ layout: defaultLayoutFromWidgets(settings.enabledWidgets) });
      } catch (error) {
        log.error("Failed to fetch host metrics preferences", error, {
          operation: "host_metrics_prefs_fetch_error",
          hostId,
        });
        res
          .status(500)
          .json({ error: "Failed to fetch host metrics preferences" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/host-metrics/host-metrics/preferences/{id}:
   *   post:
   *     summary: Save the Host Metrics layout for a host
   *     description: Saves the current user's card layout for the host. For the host's owner it also updates the host's enabled widgets.
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
  router.post(
    "/host-metrics/preferences/:id",
    validateHostId,
    async (req, res) => {
      const userId = actor(res);
      if (!userId) return;
      const hostId = Number(req.params.id);
      try {
        const access = await ctx.hosts.checkAccess(hostId, "connect");
        if (!access.hasAccess) {
          return res.status(403).json({ error: "No access to this host" });
        }
        const layout = sanitizeLayout(req.body);
        if (!layout) return res.status(400).json({ error: "Invalid layout" });

        await repository.saveLayout(userId, hostId, JSON.stringify(layout));
        if (access.isOwner) {
          await ctx.settings.setHost(
            hostId,
            "enabledWidgets",
            deriveEnabledWidgets(layout.slots),
          );
        }
        res.json({ success: true });
      } catch (error) {
        log.error("Failed to save host metrics preferences", error, {
          operation: "host_metrics_prefs_save_error",
          hostId,
        });
        res
          .status(500)
          .json({ error: "Failed to save host metrics preferences" });
      }
    },
  );

  registerManagerRoutes(router, {
    validateHostId,
    log,
    repository,
    onHealthCheck: deps.onHealthCheck,
    runOnHost: async (hostId, level, fn) => {
      const userId = ctx.currentActor();
      if (!userId) throw new AccessDeniedError("Authentication required");
      const access = await ctx.hosts.checkAccess(hostId, level);
      if (!access.hasAccess) throw new AccessDeniedError();
      const host = await poller.resolve(hostId, userId);
      if (!host) throw new AccessDeniedError("Host not found");
      return ctx.ssh.withConnection(
        host,
        {
          pool: "stats",
          purpose: "metrics",
          overrides: { readyTimeout: 60000 },
        },
        (client) =>
          fn(client as never, {
            id: host.id,
            userId: host.userId,
            actorId: userId,
            sudoPassword: sudoPasswordOf(host),
            enableDocker: !!host.enableDocker,
          }),
      );
    },
  });
}
