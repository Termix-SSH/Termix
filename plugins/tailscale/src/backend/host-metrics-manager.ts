import type { Router } from "express";
import type { Request, Response } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { AuthenticatedRequest } from "../../../../src/types/index.js";
import { DataCrypto } from "../../../../src/backend/utils/data-crypto.js";
import { PermissionManager } from "../../../../src/backend/utils/permission-manager.js";
import { resolveHostById } from "../../../../src/backend/hosts/host-resolver.js";
import { execCommand } from "../../../../src/backend/hosts/metrics-shared/common-utils.js";
import { execElevated } from "../../../../src/backend/hosts/metrics-shared/exec-elevated.js";
import { isValidTailscaleAction } from "../../../../src/backend/hosts/metrics-shared/validation.js";
import { withSshConnection } from "./ssh.js";

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

async function resolveManagerHost(
  hostId: number,
  userId: string,
): Promise<ManagerHost> {
  const access = await PermissionManager.getInstance().canAccessHost(
    userId,
    hostId,
    "connect",
  );
  if (!access.hasAccess) throw new AccessDeniedError();

  if (DataCrypto.getUserDataKey(userId) === null) {
    throw new AccessDeniedError();
  }
  const host = await resolveHostById(hostId, userId);
  if (!host) throw new AccessDeniedError("Host not found");

  let sudoPassword = (host as { sudoPassword?: string }).sudoPassword;
  const ownerId = (host as { userId?: string }).userId;
  if (ownerId && ownerId !== userId) {
    const ownerHost = await resolveHostById(hostId, ownerId);
    sudoPassword = (ownerHost as { sudoPassword?: string } | null)
      ?.sudoPassword;
  }

  return { id: hostId, userId, sudoPassword };
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
      const userId = (req as AuthenticatedRequest).userId;
      const hostId = parseInt(String(req.params.id), 10);
      try {
        const host = await resolveManagerHost(hostId, userId);
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
      const userId = (req as AuthenticatedRequest).userId;
      const hostId = parseInt(String(req.params.id), 10);
      try {
        const host = await resolveManagerHost(hostId, userId);
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
