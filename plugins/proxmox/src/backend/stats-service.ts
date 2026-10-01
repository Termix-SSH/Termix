/**
 * Proxmox node stats: polling, viewer sessions and their routes.
 *
 * Moved here from host-metrics, which only ever hosted this because the
 * plugin split predates B5. host-metrics must not import proxmox code, so
 * this plugin owns its own polling manager, SSH connections and routes.
 */

import type { Router } from "express";
import express from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { pluginCtx } from "./plugin-ctx.js";
import {
  ProxmoxPollingManager,
  parseProxmoxStatsConfig,
  type ProxmoxStatsPollableHost,
} from "./proxmox-stats-polling.js";
import type { ProxmoxNodeHistoryRepository } from "./proxmox-node-history-repository.js";

const EMPTY_SNAPSHOT = {
  node: {
    cpu: { percent: null, cores: null, load: null },
    memory: { percent: null, usedGiB: null, totalGiB: null },
    disk: { percent: null, usedGiB: null, totalGiB: null },
    uptime: { seconds: null, formatted: null },
    system: { hostname: null, kernel: null, pveVersion: null },
  },
  network: { interfaces: [] },
  guests: { guests: [], counts: { running: 0, stopped: 0, total: 0 } },
  storage: { pools: [] },
  cluster: { clustered: false },
  lastChecked: new Date(0).toISOString(),
};

type PollableHost = ProxmoxStatsPollableHost & { enableProxmoxStats: boolean };

let pollingManager: ProxmoxPollingManager<PollableHost> | undefined;
let router: Router | undefined;

async function fetchHostForPolling(
  ctx: PluginContext,
  hostId: number,
  userId: string,
): Promise<PollableHost | undefined> {
  const enabled = await ctx.asUser(userId, () =>
    ctx.settings.getHost<boolean>(hostId, "enableProxmoxStats"),
  );
  if (!enabled) return undefined;
  const host = await ctx.asUser(userId, () => ctx.hosts.get(hostId));
  if (!host) return undefined;
  const proxmoxStatsConfig = await ctx.asUser(userId, () =>
    ctx.settings.getHost(hostId, "proxmoxStatsConfig"),
  );
  return {
    id: host.id,
    userId: host.userId,
    proxmoxStatsConfig: proxmoxStatsConfig as string | undefined,
    enableProxmoxStats: true,
  };
}

/** Called from activate(). Builds the polling manager and mounts its routes. */
export function startProxmoxStatsService(
  ctx: PluginContext,
  mountOn: Router,
  historyRepository: ProxmoxNodeHistoryRepository,
): void {
  pollingManager = new ProxmoxPollingManager<PollableHost>({
    fetchHostById: (hostId, userId) => fetchHostForPolling(ctx, hostId, userId),
    withSshConnection: (host, fn) =>
      ctx.ssh.withConnection(
        host.id,
        {
          pool: "proxmox-stats",
          purpose: "proxmox",
          overrides: { readyTimeout: 60000 },
        },
        fn,
      ),
    historyRepository,
  });

  router = express.Router();
  registerRoutes(router, pollingManager, historyRepository);
  mountOn.use("/stats", router);
}

export function stopProxmoxStatsService(): void {
  pollingManager?.destroy();
  pollingManager = undefined;
  router = undefined;
}

function registerRoutes(
  app: Router,
  manager: ProxmoxPollingManager<PollableHost>,
  historyRepository: ProxmoxNodeHistoryRepository,
): void {
  /**
   * @openapi
   * /plugin-api/proxmox/stats/{id}:
   *   get:
   *     summary: Get cached Proxmox node stats for a host
   *     description: Returns the most recently polled Proxmox stats snapshot for a host, or an empty skeleton if none has been collected yet.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Proxmox stats snapshot.
   *       404:
   *         description: Stats not available yet.
   */
  app.get("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const cached = manager.getStats(id);
    if (!cached) {
      const errorState = manager.getError(id);
      return res.status(404).json({
        error: errorState?.error || "Stats not available",
        ...EMPTY_SNAPSHOT,
        lastChecked: new Date().toISOString(),
      });
    }
    res.json({
      ...cached.data,
      lastChecked: new Date(cached.timestamp).toISOString(),
    });
  });

  /**
   * @openapi
   * /plugin-api/proxmox/stats/start/{id}:
   *   post:
   *     summary: Start Proxmox stats collection
   *     description: Registers a viewer and starts (or reuses) polling for a host's Proxmox node stats.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Polling started, snapshot returned if already available.
   *       403:
   *         description: Proxmox stats is not enabled for this host.
   *       404:
   *         description: Host not found.
   */
  app.post("/start/:id", async (req, res) => {
    const id = Number(req.params.id);
    const userId = pluginCtx().currentActor()!;

    try {
      const host = await fetchHostForPolling(pluginCtx(), id, userId);
      if (!host) {
        return res
          .status(403)
          .json({ error: "Proxmox stats is not enabled for this host" });
      }

      const viewerSessionId = `proxmox-viewer-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      manager.registerViewer(id, viewerSessionId, userId);
      await manager.ensurePolling(host, userId);

      const cached = manager.getStats(id);
      if (cached) {
        return res.json({
          success: true,
          viewerSessionId,
          ...cached.data,
          lastChecked: new Date(cached.timestamp).toISOString(),
        });
      }
      const errorState = manager.getError(id);
      if (errorState) {
        return res.json({
          success: true,
          viewerSessionId,
          status: "error",
          error: errorState.error,
        });
      }
      return res.json({ success: true, viewerSessionId, status: "collecting" });
    } catch (error) {
      pluginCtx().log.error(
        `Failed to start proxmox stats collection for host ${id}`,
        error as Error,
      );
      res
        .status(500)
        .json({ error: "Failed to start proxmox stats collection" });
    }
  });

  /**
   * @openapi
   * /plugin-api/proxmox/stats/stop/{id}:
   *   post:
   *     summary: Stop Proxmox stats collection
   *     description: Unregisters a viewer session for a host's Proxmox node stats polling.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               viewerSessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Polling stopped successfully.
   */
  app.post("/stop/:id", (req, res) => {
    const id = Number(req.params.id);
    const { viewerSessionId } = req.body as { viewerSessionId?: string };
    if (viewerSessionId && typeof viewerSessionId === "string") {
      manager.unregisterViewer(id, viewerSessionId);
    }
    res.json({ success: true });
  });

  /**
   * @openapi
   * /plugin-api/proxmox/stats/heartbeat:
   *   post:
   *     summary: Update Proxmox stats viewer heartbeat
   *     description: Keeps a Proxmox stats viewer session alive.
   *     tags: [Proxmox]
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
  app.post("/heartbeat", (req, res) => {
    const { viewerSessionId } = req.body as { viewerSessionId?: string };
    if (!viewerSessionId || typeof viewerSessionId !== "string") {
      return res.status(400).json({ error: "Invalid viewerSessionId" });
    }
    const ok = manager.updateHeartbeat(viewerSessionId);
    if (!ok) return res.status(404).json({ error: "Viewer session not found" });
    res.json({ success: true });
  });

  /**
   * @openapi
   * /plugin-api/proxmox/stats/history/{hostId}:
   *   get:
   *     summary: Get historical Proxmox node stats for a host
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: hostId
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
   *           format: date-time
   *       - in: query
   *         name: to
   *         schema:
   *           type: string
   *           format: date-time
   *     responses:
   *       200:
   *         description: Array of node history rows.
   *       400:
   *         description: Invalid range or date.
   */
  app.get("/history/:hostId", async (req, res) => {
    const hostId = Number(req.params.hostId);
    const { range, from, to } = req.query as Record<string, string | undefined>;

    const RANGE_OFFSETS: Record<string, number> = {
      "1h": 1 * 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };

    let fromTs: string;
    let toTs = new Date().toISOString();
    if (range) {
      const offsetMs = RANGE_OFFSETS[range];
      if (!offsetMs) {
        return res
          .status(400)
          .json({ error: "Invalid range. Use 1h, 6h, 24h, 7d, or 30d" });
      }
      fromTs = new Date(Date.now() - offsetMs).toISOString();
    } else if (from && to) {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ error: "Invalid from/to date format" });
      }
      fromTs = fromDate.toISOString();
      toTs = toDate.toISOString();
    } else {
      fromTs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    }

    try {
      const toSqlite = (iso: string) =>
        iso.replace("T", " ").replace(/\.\d{3}Z$/, "");
      const rows = (
        await historyRepository.listRange(
          hostId,
          toSqlite(fromTs),
          toSqlite(toTs),
        )
      ).map((row) => ({
        ts: row.ts,
        cpu_percent: row.cpuPercent,
        mem_percent: row.memPercent,
        disk_percent: row.diskPercent,
        net_rx_bytes: row.netRxBytes,
        net_tx_bytes: row.netTxBytes,
      }));
      res.json({ rows, fromTs, toTs });
    } catch (error) {
      pluginCtx().log.error(
        `Failed to fetch proxmox stats history for host ${hostId}`,
        error as Error,
      );
      res.status(500).json({ error: "Failed to fetch proxmox stats history" });
    }
  });
}

export { parseProxmoxStatsConfig };
