import type { Express } from "express";
import { execCommand } from "../widgets/common-utils.js";
import { execElevated } from "./exec-elevated.js";
import { managerHandler, ManagerInputError } from "./route-helpers.js";
import type { ManagerRoutesDeps } from "./types.js";
import { isValidTailscaleAction } from "./validation.js";

export interface TailscalePeer {
  hostname: string;
  tailscaleIPs: string[];
  online: boolean;
  isExitNode: boolean;
}

export interface TailscaleData {
  installed: boolean;
  running: boolean;
  tailscaleIPs: string[];
  hostname: string | null;
  peers: TailscalePeer[];
  exitNodeInUse: boolean;
}

const PROBE_CMD = [
  "command -v tailscale >/dev/null 2>&1 && echo ts_installed=1 || echo ts_installed=0",
  "tailscale status --json 2>/dev/null",
].join("; ");

export function parseTailscaleData(output: string): TailscaleData {
  const notInstalled: TailscaleData = {
    installed: false,
    running: false,
    tailscaleIPs: [],
    hostname: null,
    peers: [],
    exitNodeInUse: false,
  };

  if (output.includes("ts_installed=0")) return notInstalled;

  // Strip the installation probe line to get the raw JSON
  const lines = output.split("\n");
  const jsonLines = lines.filter(
    (l) => !l.startsWith("ts_installed=") && l.trim() !== "",
  );
  const jsonStr = jsonLines.join("\n");

  try {
    const parsed = JSON.parse(jsonStr) as {
      BackendState?: string;
      Self?: { HostName?: string; TailscaleIPs?: string[] };
      Peer?: Record<
        string,
        {
          HostName?: string;
          TailscaleIPs?: string[];
          Online?: boolean;
          ExitNode?: boolean;
        }
      >;
      CurrentExitNode?: string;
    };

    const peers: TailscalePeer[] = Object.values(parsed.Peer ?? {}).map(
      (p) => ({
        hostname: p.HostName ?? "",
        tailscaleIPs: p.TailscaleIPs ?? [],
        online: p.Online ?? false,
        isExitNode: p.ExitNode ?? false,
      }),
    );

    return {
      installed: true,
      running: parsed.BackendState === "Running",
      tailscaleIPs: parsed.Self?.TailscaleIPs ?? [],
      hostname: parsed.Self?.HostName ?? null,
      peers,
      exitNodeInUse:
        typeof parsed.CurrentExitNode === "string" &&
        parsed.CurrentExitNode !== "",
    };
  } catch {
    return {
      installed: true,
      running: false,
      tailscaleIPs: [],
      hostname: null,
      peers: [],
      exitNodeInUse: false,
    };
  }
}

export function registerTailscaleRoutes(
  app: Express,
  { validateHostId, runOnHost }: ManagerRoutesDeps,
): void {
  /**
   * @openapi
   * /host-metrics/managers/tailscale/{id}:
   *   get:
   *     summary: Get Tailscale status and IPs
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
   *         description: Tailscale installation status, running state, IPs, and peer count.
   */
  app.get(
    "/host-metrics/managers/tailscale/:id",
    validateHostId,
    managerHandler(runOnHost, "read", "tailscale_read", async (client) => {
      const { stdout } = await execCommand(client, PROBE_CMD, 15000);
      return parseTailscaleData(stdout);
    }),
  );

  /**
   * @openapi
   * /host-metrics/managers/tailscale/{id}/action:
   *   post:
   *     summary: Connect or disconnect Tailscale
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
   *               action:
   *                 type: string
   *                 enum: [up, down]
   *     responses:
   *       200:
   *         description: Action result.
   */
  app.post(
    "/host-metrics/managers/tailscale/:id/action",
    validateHostId,
    managerHandler(
      runOnHost,
      "execute",
      "tailscale_action",
      async (client, host, req) => {
        const { action } = req.body as { action: unknown };
        if (!isValidTailscaleAction(action)) {
          throw new ManagerInputError("Invalid action, must be 'up' or 'down'");
        }
        const result = await execElevated(
          client,
          `tailscale ${action}`,
          host.sudoPassword,
          { forceSudo: false, timeoutMs: 30000 },
        );
        return {
          success: result.code === 0,
          output: (result.stdout + result.stderr).trim(),
        };
      },
    ),
  );
}
