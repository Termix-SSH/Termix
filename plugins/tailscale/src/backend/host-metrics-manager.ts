import type { Router } from "express";
import type { Request, Response } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { execCommand, execElevated } from "@termix/plugin-sdk/host-commands";
import { withSshConnection } from "./ssh.js";

export type TailscaleAction = "up" | "down";

export function isValidTailscaleAction(a: unknown): a is TailscaleAction {
  return a === "up" || a === "down";
}

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

class AccessDeniedError extends Error {
  constructor(message = "No access to this host") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

class ManagerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagerInputError";
  }
}

interface ManagerHost {
  id: number;
  userId: string;
  sudoPassword?: string;
}

/**
 * The host as the acting user may reach it. The resolved host carries the
 * owner's sudo password even for a shared user: core decrypts it with the
 * owner's key.
 */
async function resolveManagerHost(
  ctx: PluginContext,
  hostId: number,
): Promise<ManagerHost> {
  const access = await ctx.hosts.checkAccess(hostId, "connect");
  if (!access.hasAccess) throw new AccessDeniedError();
  const host = await ctx.ssh.resolveHost(hostId);
  if (!host) throw new AccessDeniedError("Host not found");
  const terminalConfig = host.terminalConfig as
    { sudoPassword?: string } | undefined;
  return {
    id: hostId,
    userId: String(host.userId ?? ""),
    sudoPassword:
      (host.sudoPassword as string | undefined) ||
      terminalConfig?.sudoPassword ||
      undefined,
  };
}

function managerErrorResponse(
  res: Response,
  operation: string,
  error: unknown,
) {
  if (error instanceof ManagerInputError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof AccessDeniedError) {
    return res.status(403).json({ error: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return res.status(500).json({ error: message || `${operation} failed` });
}

export function registerTailscaleHostMetricsManager(
  router: Router,
  ctx: PluginContext,
): void {
  /**
   * @openapi
   * /plugin-api/tailscale/host-metrics-manager/{id}:
   *   get:
   *     summary: Get Tailscale status and IPs for a host
   *     tags:
   *       - Tailscale
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
  router.get(
    "/host-metrics-manager/:id",
    async (req: Request, res: Response) => {
      const hostId = parseInt(String(req.params.id), 10);
      try {
        const host = await resolveManagerHost(ctx, hostId);
        const data = await withSshConnection(
          host.id,
          { pool: "tailscale", purpose: "metrics" },
          async (client) => {
            const { stdout } = await execCommand(client, PROBE_CMD, 15000);
            return parseTailscaleData(stdout);
          },
        );
        res.json(data);
      } catch (error) {
        ctx.log.error(
          "Failed to read Tailscale status",
          error instanceof Error ? error : undefined,
        );
        managerErrorResponse(res, "tailscale_read", error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/tailscale/host-metrics-manager/{id}/action:
   *   post:
   *     summary: Connect or disconnect Tailscale on a host
   *     tags:
   *       - Tailscale
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
  router.post(
    "/host-metrics-manager/:id/action",
    async (req: Request, res: Response) => {
      const hostId = parseInt(String(req.params.id), 10);
      try {
        const host = await resolveManagerHost(ctx, hostId);
        const { action } = req.body as { action: unknown };
        if (!isValidTailscaleAction(action)) {
          throw new ManagerInputError("Invalid action, must be 'up' or 'down'");
        }
        const result = await withSshConnection(
          host.id,
          { pool: "tailscale", purpose: "metrics" },
          (client) =>
            execElevated(client, `tailscale ${action}`, host.sudoPassword, {
              forceSudo: false,
              timeoutMs: 30000,
            }),
        );
        res.json({
          success: result.code === 0,
          output: (result.stdout + result.stderr).trim(),
        });
      } catch (error) {
        ctx.log.error(
          "Failed to run Tailscale action",
          error instanceof Error ? error : undefined,
        );
        managerErrorResponse(res, "tailscale_action", error);
      }
    },
  );
}
