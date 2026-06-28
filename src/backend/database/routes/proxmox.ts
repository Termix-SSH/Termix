import express from "express";
import { Client as SSHClient } from "ssh2";
import { getDb } from "../db/index.js";
import { hosts, sshCredentials } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { logger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { SSHHost } from "../../../types/index.js";
import { SSHHostKeyVerifier } from "../../ssh/host-key-verifier.js";

const router = express.Router();
const proxmoxLogger = logger;

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Proxmox node names are restricted to [a-zA-Z0-9-] by PVE itself,
// but we validate defensively before using in a shell command.
const SAFE_NODE_RE = /^[a-zA-Z0-9._-]{1,64}$/;

function isSafeNodeName(name: string): boolean {
  return SAFE_NODE_RE.test(name);
}

function execCommand(
  client: SSHClient,
  command: string,
  timeoutMs = 8000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }
      let stdout = "";
      let stderr = "";
      stream.on("close", (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0)
          reject(new Error(stderr || `Command exited with code ${code}`));
        else resolve(stdout);
      });
      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    });
  });
}

// Parse all IPs from LXC net config, then return the one matching the preferred prefix.
function parseLxcIp(
  config: Record<string, unknown>,
  preferredPrefixes: string[] = [],
): string | null {
  const ips: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (/^net\d+$/.test(key) && typeof value === "string") {
      const m = value.match(/ip=(\d{1,3}(?:\.\d{1,3}){3})/);
      if (m) ips.push(m[1]);
    }
  }
  if (!ips.length) return null;
  for (const prefix of preferredPrefixes) {
    const match = ips.find((ip) => ip.startsWith(prefix));
    if (match) return match;
  }
  return ips[0];
}

function matchesAny(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

function parseProxmoxConfig(raw: unknown): {
  windowsPatterns: string[];
  dockerPatterns: string[];
  preferredPrefixes: string[];
} {
  const split = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  if (!raw || typeof raw !== "object") {
    return {
      windowsPatterns: ["win", "windows"],
      dockerPatterns: ["docker"],
      preferredPrefixes: [],
    };
  }
  const cfg = raw as Record<string, unknown>;
  return {
    windowsPatterns: split(
      typeof cfg.windowsPatterns === "string"
        ? cfg.windowsPatterns
        : "win,windows",
    ),
    dockerPatterns: split(
      typeof cfg.dockerPatterns === "string" ? cfg.dockerPatterns : "docker",
    ),
    preferredPrefixes: split(
      typeof cfg.preferredPrefixes === "string" ? cfg.preferredPrefixes : "",
    ),
  };
}

/**
 * @openapi
 * /proxmox/discover:
 *   post:
 *     summary: Discover Proxmox guests on a node
 *     description: >
 *       Connects to an existing SSH host (a Proxmox node) using its stored
 *       credentials, runs pvesh to enumerate all guests (VMs and LXC
 *       containers) in the cluster, and returns them ready to be imported as
 *       Termix hosts. No separate Proxmox API token is required.
 *     tags: [Proxmox]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [hostId]
 *             properties:
 *               hostId:
 *                 type: number
 *                 description: ID of the SSH host that is a Proxmox node.
 *     responses:
 *       200:
 *         description: Discovered guests.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 guests:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       vmid:
 *                         type: number
 *                       type:
 *                         type: string
 *                         enum: [qemu, lxc]
 *                       node:
 *                         type: string
 *                       status:
 *                         type: string
 *                       ip:
 *                         type: string
 *                         nullable: true
 *                       connectionType:
 *                         type: string
 *                         enum: [ssh, rdp]
 *                       enableDocker:
 *                         type: boolean
 *                 credentialId:
 *                   type: number
 *                   nullable: true
 *                 defaultCredentialId:
 *                   type: number
 *                   nullable: true
 *       400:
 *         description: Missing or invalid hostId.
 *       401:
 *         description: Authentication required or session expired.
 *       403:
 *         description: Access denied to the host.
 *       404:
 *         description: Host not found.
 *       422:
 *         description: Host is not a Proxmox node or is unreachable.
 *       500:
 *         description: Discovery failed.
 */
router.post(
  "/discover",
  authenticateJWT,
  requireDataAccess,
  async (req, res) => {
    const { hostId } = req.body as { hostId?: unknown };
    const userId = (req as unknown as AuthenticatedRequest).userId;

    const parsedHostId = Number(hostId);
    if (!hostId || !Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      return res.status(400).json({ error: "Missing or invalid hostId" });
    }

    try {
      if (!SimpleDBOps.isUserDataUnlocked(userId)) {
        return res.status(401).json({
          error: "Session expired — please log in again",
          code: "SESSION_EXPIRED",
        });
      }

      // -----------------------------------------------------------------------
      // Load host from DB
      // -----------------------------------------------------------------------
      const hostResults = await SimpleDBOps.select(
        getDb().select().from(hosts).where(eq(hosts.id, parsedHostId)),
        "ssh_data",
        userId,
      );

      if (!hostResults.length) {
        return res.status(404).json({ error: "Host not found" });
      }

      const host = hostResults[0] as unknown as SSHHost;

      // Read discovery settings from the host's proxmoxConfig
      const proxmoxCfgRaw = host.proxmoxConfig
        ? typeof host.proxmoxConfig === "string"
          ? JSON.parse(host.proxmoxConfig)
          : host.proxmoxConfig
        : null;
      const { windowsPatterns, dockerPatterns, preferredPrefixes } =
        parseProxmoxConfig(proxmoxCfgRaw);
      const proxmoxDefaultCredentialId =
        proxmoxCfgRaw && typeof proxmoxCfgRaw === "object"
          ? (((proxmoxCfgRaw as Record<string, unknown>).defaultCredentialId as
              | number
              | null) ?? null)
          : null;

      // -----------------------------------------------------------------------
      // Permission check
      // -----------------------------------------------------------------------
      if (host.userId !== userId) {
        const { PermissionManager } =
          await import("../../utils/permission-manager.js");
        const pm = PermissionManager.getInstance();
        const access = await pm.canAccessHost(userId, parsedHostId, "execute");
        if (!access.hasAccess) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      // -----------------------------------------------------------------------
      // Credential resolution (mirrors docker.ts pattern)
      // -----------------------------------------------------------------------
      let resolvedCredentials: {
        password?: string;
        sshKey?: string;
        keyPassword?: string;
        authType?: string;
      } = {
        password: host.password,
        sshKey: host.key,
        keyPassword: host.keyPassword,
        authType: host.authType,
      };

      const hostCredentialId = host.credentialId ?? null;

      if (host.credentialId) {
        if (userId !== host.userId) {
          try {
            const { SharedCredentialManager } =
              await import("../../utils/shared-credential-manager.js");
            const sharedCred =
              await SharedCredentialManager.getInstance().getSharedCredentialForUser(
                host.id,
                userId,
              );
            if (sharedCred) {
              resolvedCredentials = {
                password: sharedCred.password,
                sshKey: sharedCred.key,
                keyPassword: sharedCred.keyPassword,
                authType: sharedCred.authType,
              };
            }
          } catch (err) {
            proxmoxLogger.error("Failed to resolve shared credential", err, {
              operation: "proxmox_discover",
              hostId: parsedHostId,
              userId,
            });
          }
        } else {
          const creds = await SimpleDBOps.select(
            getDb()
              .select()
              .from(sshCredentials)
              .where(
                and(
                  eq(sshCredentials.id, host.credentialId as number),
                  eq(sshCredentials.userId, userId),
                ),
              ),
            "ssh_credentials",
            userId,
          );
          if (creds.length > 0) {
            const c = creds[0];
            resolvedCredentials = {
              password: c.password as string | undefined,
              sshKey: (c.key || c.privateKey) as string | undefined,
              keyPassword: c.keyPassword as string | undefined,
              authType: c.authType as string | undefined,
            };
          }
        }
      }

      // -----------------------------------------------------------------------
      // Build SSH config
      // -----------------------------------------------------------------------
      const sshConfig: Record<string, unknown> = {
        host: host.ip?.replace(/^\[|\]$/g, "") || host.ip,
        port: host.port || 22,
        username: host.username,
        tryKeyboard: false,
        readyTimeout: 30000,
        hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
          parsedHostId,
          host.ip,
          host.port || 22,
          null,
          userId,
          false,
        ),
      };

      const authType = resolvedCredentials.authType;
      if (authType === "key" && resolvedCredentials.sshKey) {
        sshConfig.privateKey = resolvedCredentials.sshKey;
        if (resolvedCredentials.keyPassword)
          sshConfig.passphrase = resolvedCredentials.keyPassword;
      } else if (authType === "agent") {
        const { applyAgentAuth } =
          await import("../../ssh/terminal-auth-helpers.js");
        const result = await applyAgentAuth(
          sshConfig,
          host.terminalConfig as unknown as Record<string, unknown> | undefined,
        );
        if ("error" in result) {
          return res.status(400).json({ error: result.error });
        }
      } else if (resolvedCredentials.password) {
        sshConfig.password = resolvedCredentials.password;
      }

      // -----------------------------------------------------------------------
      // Connect → discover → disconnect
      // -----------------------------------------------------------------------
      const client = new SSHClient();

      try {
        await new Promise<void>((resolve, reject) => {
          client.on("ready", resolve);
          client.on("error", reject);
          client.connect(sshConfig as import("ssh2").ConnectConfig);
        });

        proxmoxLogger.info("Proxmox discovery SSH connection established", {
          operation: "proxmox_discover",
          hostId: parsedHostId,
          userId,
        });

        // Verify pvesh is present — fail fast with a clear error
        const pveshCheck = await execCommand(
          client,
          "command -v pvesh >/dev/null 2>&1 && echo ok || echo missing",
        );
        if (pveshCheck.trim() !== "ok") {
          return res
            .status(422)
            .json({ error: "pvesh not found — is this a Proxmox node?" });
        }

        // Fetch all cluster resources in one call
        const resourcesJson = await execCommand(
          client,
          "pvesh get /cluster/resources --output-format json 2>/dev/null",
        );

        let resources: Array<Record<string, unknown>>;
        try {
          resources = JSON.parse(resourcesJson);
        } catch {
          return res.status(502).json({
            error: "Failed to parse pvesh output — unexpected response",
          });
        }

        // Collect basic guest metadata first (no IP yet)
        type GuestBase = {
          name: string;
          vmid: number;
          type: "qemu" | "lxc";
          node: string;
          status: string;
        };

        const guestBases: GuestBase[] = [];
        for (const r of resources) {
          const type = r.type as string;
          if (type !== "qemu" && type !== "lxc") continue;
          if (r.template) continue;
          const node = r.node as string;
          if (!isSafeNodeName(node)) {
            proxmoxLogger.warn("Skipping guest with unsafe node name", {
              operation: "proxmox_discover",
              node,
              vmid: r.vmid,
            });
            continue;
          }
          guestBases.push({
            name: (r.name as string) || String(r.vmid),
            vmid: Number(r.vmid),
            type: type as "qemu" | "lxc",
            node,
            status: (r.status as string) || "unknown",
          });
        }

        // Resolve IPs for all guests in parallel — keeps total time near
        // max(single_resolution) instead of sum(all_resolutions).
        async function resolveIp(g: GuestBase): Promise<string | null> {
          if (g.type === "lxc") {
            try {
              const cfgJson = await execCommand(
                client,
                `pvesh get /nodes/${g.node}/lxc/${g.vmid}/config --output-format json 2>/dev/null`,
                8000,
              );
              return parseLxcIp(JSON.parse(cfgJson), preferredPrefixes);
            } catch {
              return null;
            }
          }
          if (g.type === "qemu" && g.status === "running") {
            try {
              const ifJson = await execCommand(
                client,
                `pvesh get /nodes/${g.node}/qemu/${g.vmid}/agent/network-get-interfaces --output-format json 2>/dev/null`,
                5000,
              );
              const data = JSON.parse(ifJson);
              const ifaces: Array<Record<string, unknown>> = Array.isArray(
                data?.result,
              )
                ? data.result
                : Array.isArray(data)
                  ? data
                  : [];
              const allIps: string[] = [];
              for (const iface of ifaces) {
                if (iface.name === "lo") continue;
                const addrs =
                  (iface["ip-addresses"] as Array<Record<string, string>>) ??
                  [];
                for (const a of addrs) {
                  if (
                    a["ip-address-type"] === "ipv4" &&
                    !a["ip-address"].startsWith("127.")
                  ) {
                    allIps.push(a["ip-address"]);
                  }
                }
              }
              if (allIps.length) {
                for (const prefix of preferredPrefixes) {
                  const match = allIps.find((ip) => ip.startsWith(prefix));
                  if (match) return match;
                }
                return allIps[0];
              }
            } catch {
              // Guest agent absent or timed out
            }
          }
          return null;
        }

        // Resolve IPs with bounded concurrency: each lookup opens an SSH exec
        // channel, and OpenSSH's default MaxSessions is 10. Capping the number
        // of in-flight channels keeps discovery reliable on large clusters.
        const CONCURRENCY = 6;
        const ips: (string | null)[] = new Array(guestBases.length).fill(null);
        let cursor = 0;
        async function ipWorker() {
          while (cursor < guestBases.length) {
            const i = cursor++;
            ips[i] = await resolveIp(guestBases[i]);
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, guestBases.length) }, () =>
            ipWorker(),
          ),
        );
        const guests = guestBases.map((g, i) => ({
          ...g,
          ip: ips[i],
          connectionType: matchesAny(g.name, windowsPatterns) ? "rdp" : "ssh",
          enableDocker: matchesAny(g.name, dockerPatterns),
        }));

        proxmoxLogger.info("Proxmox discovery completed", {
          operation: "proxmox_discover",
          hostId: parsedHostId,
          userId,
          guestCount: guests.length,
        });

        // Return guests with connection type + docker flag, plus credential info
        // so the frontend can pre-populate auth for imported hosts.
        return res.json({
          guests,
          credentialId: hostCredentialId,
          defaultCredentialId: proxmoxDefaultCredentialId,
        });
      } finally {
        try {
          client.end();
        } catch {
          // ignore cleanup errors
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      proxmoxLogger.error("Proxmox discovery failed", err, {
        operation: "proxmox_discover",
        hostId: parsedHostId,
        userId,
      });

      if (
        message.includes("pvesh not found") ||
        message.includes("Authentication failed") ||
        message.includes("connect ECONNREFUSED") ||
        message.includes("connect ETIMEDOUT")
      ) {
        return res.status(422).json({ error: `Discovery failed: ${message}` });
      }
      return res.status(500).json({ error: `Discovery failed: ${message}` });
    }
  },
);

export default router;
