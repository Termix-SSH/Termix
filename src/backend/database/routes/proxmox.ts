import express from "express";
import { Client as SSHClient } from "ssh2";
import { logger } from "../../utils/logger.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import {
  createCurrentCredentialRepository,
  createCurrentHostRepository,
} from "../repositories/factory.js";
import { AuthManager } from "../../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { SSHHost } from "../../../types/index.js";
import { SSHHostKeyVerifier } from "../../hosts/host-key-verifier.js";

const router = express.Router();
const proxmoxLogger = logger;
const runningSyncs = new Set<string>();

const MIN_SYNC_INTERVAL_MINUTES = 5;
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// Helpers

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
  defaultCredentialId: number | null;
  defaultAuthType: string;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  markMissingGuests: boolean;
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
      defaultCredentialId: null,
      defaultAuthType: "password",
      autoSyncEnabled: false,
      syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
      markMissingGuests: true,
    };
  }
  const cfg = raw as Record<string, unknown>;
  const interval =
    typeof cfg.syncIntervalMinutes === "number"
      ? cfg.syncIntervalMinutes
      : Number.parseInt(String(cfg.syncIntervalMinutes ?? ""), 10);
  return {
    defaultCredentialId:
      typeof cfg.defaultCredentialId === "number"
        ? cfg.defaultCredentialId
        : null,
    defaultAuthType:
      typeof cfg.defaultAuthType === "string"
        ? cfg.defaultAuthType
        : "password",
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
    autoSyncEnabled: cfg.autoSyncEnabled === true,
    syncIntervalMinutes:
      Number.isFinite(interval) && interval >= MIN_SYNC_INTERVAL_MINUTES
        ? interval
        : DEFAULT_SYNC_INTERVAL_MINUTES,
    markMissingGuests: cfg.markMissingGuests !== false,
  };
}

type ProxmoxGuest = {
  name: string;
  vmid: number;
  type: "qemu" | "lxc";
  node: string;
  status: string;
  ip: string | null;
  connectionType: "ssh" | "rdp";
  enableDocker: boolean;
};

type ProxmoxSource = {
  source: "proxmox";
  sourceHostId: number;
  node: string;
  vmid: number;
  type: "qemu" | "lxc";
  lastSeenAt?: string;
  lastStatus?: string;
  missingSince?: string | null;
};

type ProxmoxSyncResult = {
  created: number;
  updated: number;
  markedMissing: number;
  skipped: number;
  errors: string[];
};

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getProxmoxSource(host: Record<string, unknown>): ProxmoxSource | null {
  const config = parseJsonObject(host.proxmoxConfig);
  const source = config.source;
  if (!source || typeof source !== "object") return null;
  const src = source as Record<string, unknown>;
  if (
    src.source !== "proxmox" ||
    typeof src.sourceHostId !== "number" ||
    typeof src.node !== "string" ||
    typeof src.vmid !== "number" ||
    (src.type !== "qemu" && src.type !== "lxc")
  ) {
    return null;
  }
  return src as ProxmoxSource;
}

function proxmoxSourceKey(source: ProxmoxSource): string {
  return `${source.sourceHostId}:${source.node}:${source.type}:${source.vmid}`;
}

function guestSourceKey(sourceHostId: number, guest: ProxmoxGuest): string {
  return `${sourceHostId}:${guest.node}:${guest.type}:${guest.vmid}`;
}

function mergeTags(
  existing: unknown,
  additions: string[],
  removals: string[] = [],
): string {
  const removeSet = new Set(removals);
  const base =
    typeof existing === "string"
      ? existing
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : Array.isArray(existing)
        ? existing
            .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
            .filter(Boolean)
        : [];
  return [...new Set([...base, ...additions])]
    .filter((tag) => !removeSet.has(tag))
    .join(",");
}

function resolveProxmoxImportAuth(
  defaultAuthType: string | undefined,
  credentialId: number | null | undefined,
): {
  authType: string;
  credentialId: number | null;
  overrideCredentialUsername: number;
} {
  if (defaultAuthType === "credential" || (!defaultAuthType && credentialId)) {
    return credentialId
      ? { authType: "credential", credentialId, overrideCredentialUsername: 1 }
      : { authType: "none", credentialId: null, overrideCredentialUsername: 0 };
  }

  if (defaultAuthType && !["password", "key"].includes(defaultAuthType)) {
    return {
      authType: defaultAuthType,
      credentialId: null,
      overrideCredentialUsername: 0,
    };
  }

  return {
    authType: "none",
    credentialId: null,
    overrideCredentialUsername: 0,
  };
}

async function discoverProxmoxGuestsForHost(
  userId: string,
  parsedHostId: number,
): Promise<{
  host: SSHHost;
  guests: ProxmoxGuest[];
  credentialId: number | null;
  defaultCredentialId: number | null;
  config: ReturnType<typeof parseProxmoxConfig>;
}> {
  if (!DataCrypto.canUserAccessData(userId)) {
    const error = new Error("Session expired — please log in again");
    (error as Error & { code?: string }).code = "SESSION_EXPIRED";
    throw error;
  }

  const hostRecord = await createCurrentHostRepository().findDecryptedByIdAs(
    userId,
    parsedHostId,
  );

  if (!hostRecord) {
    const error = new Error("Host not found");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  const host = hostRecord as unknown as SSHHost;
  const proxmoxCfgRaw = parseJsonObject(host.proxmoxConfig);
  const config = parseProxmoxConfig(proxmoxCfgRaw);

  if (host.userId !== userId) {
    const { PermissionManager } =
      await import("../../utils/permission-manager.js");
    const pm = PermissionManager.getInstance();
    const access = await pm.canAccessHost(userId, parsedHostId, "connect");
    if (!access.hasAccess) {
      const error = new Error("Access denied");
      (error as Error & { status?: number }).status = 403;
      throw error;
    }
  }

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
        const { SharedHostSecretsManager } =
          await import("../../utils/shared-host-secrets-manager.js");
        const sharedCred =
          await SharedHostSecretsManager.getInstance().getSecretForUser(
            host.id,
            userId,
            "ssh",
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
      const cred =
        await createCurrentCredentialRepository().findDecryptedByIdForUser(
          userId,
          host.credentialId as number,
        );
      if (cred) {
        const c = cred;
        resolvedCredentials = {
          password: c.password as string | undefined,
          sshKey: (c.key || c.privateKey) as string | undefined,
          keyPassword: c.keyPassword as string | undefined,
          authType: c.authType as string | undefined,
        };
      }
    }
  }

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
      await import("../../hosts/terminal-auth-helpers.js");
    const result = await applyAgentAuth(
      sshConfig,
      host.terminalConfig as unknown as Record<string, unknown> | undefined,
    );
    if ("error" in result) {
      const error = new Error(result.error);
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
  } else if (resolvedCredentials.password) {
    sshConfig.password = resolvedCredentials.password;
  }

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

    const pveshCheck = await execCommand(
      client,
      "command -v pvesh >/dev/null 2>&1 && echo ok || echo missing",
    );
    if (pveshCheck.trim() !== "ok") {
      const error = new Error("pvesh not found — is this a Proxmox node?");
      (error as Error & { status?: number }).status = 422;
      throw error;
    }

    const resourcesJson = await execCommand(
      client,
      "pvesh get /cluster/resources --output-format json 2>/dev/null",
    );

    let resources: Array<Record<string, unknown>>;
    try {
      resources = JSON.parse(resourcesJson);
    } catch {
      const error = new Error(
        "Failed to parse pvesh output — unexpected response",
      );
      (error as Error & { status?: number }).status = 502;
      throw error;
    }

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

    async function resolveIp(g: GuestBase): Promise<string | null> {
      if (g.type === "lxc") {
        let configIp: string | null = null;
        try {
          const cfgJson = await execCommand(
            client,
            `pvesh get /nodes/${g.node}/lxc/${g.vmid}/config --output-format json 2>/dev/null`,
            8000,
          );
          configIp = parseLxcIp(JSON.parse(cfgJson), config.preferredPrefixes);
        } catch {
          configIp = null;
        }
        if (configIp) return configIp;
        // Static config parsing found nothing (e.g. net0 uses ip=dhcp).
        // Fall back to the live interface list for running containers.
        if (g.status === "running") {
          try {
            const ifRaw = await execCommand(
              client,
              `pvesh get /nodes/${g.node}/lxc/${g.vmid}/interfaces --output-format json 2>/dev/null`,
              5000,
            );
            const data = JSON.parse(ifRaw);
            const entries: Array<Record<string, unknown>> = Array.isArray(data)
              ? data
              : [];
            const allIps: string[] = [];
            for (const entry of entries) {
              if (entry.name === "lo") continue;
              const inet = entry.inet;
              if (typeof inet !== "string") continue;
              const m = inet.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/\d+$/);
              if (m && !m[1].startsWith("127.")) allIps.push(m[1]);
            }
            if (allIps.length) {
              for (const prefix of config.preferredPrefixes) {
                const match = allIps.find((ip) => ip.startsWith(prefix));
                if (match) return match;
              }
              return allIps[0];
            }
          } catch {
            // Guest not running or interfaces unavailable
          }
        }
        return null;
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
              (iface["ip-addresses"] as Array<Record<string, string>>) ?? [];
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
            for (const prefix of config.preferredPrefixes) {
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

    const guests: ProxmoxGuest[] = guestBases.map((g, i) => ({
      ...g,
      ip: ips[i],
      connectionType: matchesAny(g.name, config.windowsPatterns)
        ? "rdp"
        : "ssh",
      enableDocker: matchesAny(g.name, config.dockerPatterns),
    }));

    proxmoxLogger.info("Proxmox discovery completed", {
      operation: "proxmox_discover",
      hostId: parsedHostId,
      userId,
      guestCount: guests.length,
    });

    return {
      host,
      guests,
      credentialId: hostCredentialId,
      defaultCredentialId: config.defaultCredentialId,
      config,
    };
  } finally {
    try {
      client.end();
    } catch {
      // ignore cleanup errors
    }
  }
}

async function syncProxmoxHost(
  userId: string,
  sourceHostId: number,
): Promise<ProxmoxSyncResult> {
  const lockKey = `${userId}:${sourceHostId}`;
  if (runningSyncs.has(lockKey)) {
    return {
      created: 0,
      updated: 0,
      markedMissing: 0,
      skipped: 0,
      errors: ["Sync already running"],
    };
  }

  runningSyncs.add(lockKey);
  const result: ProxmoxSyncResult = {
    created: 0,
    updated: 0,
    markedMissing: 0,
    skipped: 0,
    errors: [],
  };
  const startedAt = new Date().toISOString();

  try {
    const discovery = await discoverProxmoxGuestsForHost(userId, sourceHostId);
    const sourceHostName = discovery.host.name || "Proxmox";
    const defaultCredentialId =
      discovery.config.defaultCredentialId ?? discovery.credentialId ?? null;
    const importAuth = resolveProxmoxImportAuth(
      discovery.config.defaultAuthType,
      defaultCredentialId,
    );
    const now = new Date().toISOString();

    const existingHosts =
      (await createCurrentHostRepository().listDecryptedByUserId(
        userId,
      )) as unknown as Record<string, unknown>[];
    const existingBySource = new Map<string, Record<string, unknown>>();
    for (const host of existingHosts) {
      const source = getProxmoxSource(host);
      if (source?.sourceHostId === sourceHostId) {
        existingBySource.set(proxmoxSourceKey(source), host);
      }
    }

    const seen = new Set<string>();
    for (const guest of discovery.guests) {
      const key = guestSourceKey(sourceHostId, guest);
      seen.add(key);
      const existing = existingBySource.get(key);
      const source: ProxmoxSource = {
        source: "proxmox",
        sourceHostId,
        node: guest.node,
        vmid: guest.vmid,
        type: guest.type,
        lastSeenAt: now,
        lastStatus: guest.status,
        missingSince: null,
      };

      if (!existing && !guest.ip) {
        result.skipped++;
        result.errors.push(
          `${guest.name}: skipped because no IP address was discovered`,
        );
        continue;
      }

      const baseConfig = existing
        ? parseJsonObject(existing.proxmoxConfig)
        : {};
      const proxmoxConfig = {
        ...baseConfig,
        source,
      };
      const existingConnectionType =
        existing?.connectionType === "ssh" || existing?.connectionType === "rdp"
          ? existing.connectionType
          : null;
      const connectionType = existingConnectionType ?? guest.connectionType;
      const port =
        typeof existing?.port === "number"
          ? existing.port
          : connectionType === "rdp"
            ? 3389
            : 22;
      const username =
        typeof existing?.username === "string" && existing.username
          ? existing.username
          : connectionType === "rdp"
            ? null
            : "root";
      const update: Record<string, unknown> = {
        name: guest.name,
        ip: guest.ip || existing?.ip,
        port,
        username,
        connectionType,
        folder: existing?.folder || sourceHostName,
        tags: mergeTags(
          existing?.tags,
          ["proxmox", guest.type, guest.node],
          ["proxmox-missing"],
        ),
        proxmoxConfig: JSON.stringify(proxmoxConfig),
        updatedAt: now,
      };

      if (existing) {
        await createCurrentHostRepository().updateEncryptedForUser(
          userId,
          existing.id as number,
          update,
        );
        result.updated++;
        continue;
      }

      Object.assign(update, {
        enableTerminal: connectionType !== "rdp",
        enableFileManager: connectionType !== "rdp",
        enableTunnel: connectionType !== "rdp",
        enableDocker: guest.enableDocker,
        enableSsh: connectionType === "ssh",
        enableRdp: connectionType === "rdp",
      });

      await createCurrentHostRepository().createEncryptedForUser(userId, {
        ...update,
        userId,
        createdAt: now,
        pin: false,
        authType: connectionType === "rdp" ? "password" : importAuth.authType,
        credentialId: connectionType === "ssh" ? importAuth.credentialId : null,
        overrideCredentialUsername: importAuth.overrideCredentialUsername,
        password: null,
        key: null,
        keyPassword: null,
        keyType: null,
        rdpUser: null,
        rdpPassword: null,
        rdpDomain: null,
        rdpSecurity: null,
        rdpIgnoreCert: 0,
        rdpPort: connectionType === "rdp" ? 3389 : null,
        vncUser: null,
        vncPassword: null,
        vncPort: null,
        telnetUser: null,
        telnetPassword: null,
        telnetPort: null,
        defaultPath: "/",
        tunnelConnections: "[]",
        jumpHosts: null,
        quickActions: null,
        statsConfig: null,
        dockerConfig: null,
        terminalConfig: null,
        forceKeyboardInteractive: "false",
        useSocks5: 0,
        socks5Host: null,
        socks5Port: null,
        socks5Username: null,
        socks5Password: null,
        socks5ProxyChain: null,
        portKnockSequence: null,
        showTerminalInSidebar: 0,
        showFileManagerInSidebar: 0,
        showTunnelInSidebar: 0,
        showDockerInSidebar: 0,
        showServerStatsInSidebar: 0,
      });
      result.created++;
    }

    if (discovery.config.markMissingGuests) {
      for (const [key, existing] of existingBySource.entries()) {
        if (seen.has(key)) continue;
        const config = parseJsonObject(existing.proxmoxConfig);
        const source = getProxmoxSource(existing);
        if (!source) continue;
        const missingSince = source.missingSince || now;
        await createCurrentHostRepository().updateEncryptedForUser(
          userId,
          existing.id as number,
          {
            tags: mergeTags(existing.tags, ["proxmox-missing"]),
            proxmoxConfig: JSON.stringify({
              ...config,
              source: {
                ...source,
                missingSince,
              },
            }),
            updatedAt: now,
          },
        );
        result.markedMissing++;
      }
    }

    await writeSyncStatus(userId, sourceHostId, {
      lastSyncAt: startedAt,
      lastSyncStatus: "success",
      lastSyncError: null,
      lastSyncResult: result,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(message);
    await writeSyncStatus(userId, sourceHostId, {
      lastSyncAt: startedAt,
      lastSyncStatus: "error",
      lastSyncError: message,
      lastSyncResult: result,
    });
    throw error;
  } finally {
    runningSyncs.delete(lockKey);
  }
}

async function writeSyncStatus(
  userId: string,
  hostId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const hostRepository = createCurrentHostRepository();
  const row = await hostRepository.findByIdForUser(userId, hostId);
  if (!row) return;
  const config = parseJsonObject(row.proxmoxConfig);
  await hostRepository.updateForUser(userId, hostId, {
    proxmoxConfig: JSON.stringify({ ...config, ...patch }),
  });
}

router.post("/sync", authenticateJWT, requireDataAccess, async (req, res) => {
  const { hostId } = req.body as { hostId?: unknown };
  const userId = (req as unknown as AuthenticatedRequest).userId;

  const parsedHostId = Number(hostId);
  if (!hostId || !Number.isInteger(parsedHostId) || parsedHostId <= 0) {
    return res.status(400).json({ error: "Missing or invalid hostId" });
  }

  try {
    const result = await syncProxmoxHost(userId, parsedHostId);
    return res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status =
      (err as Error & { code?: string; status?: number }).code ===
      "SESSION_EXPIRED"
        ? 401
        : (err as Error & { status?: number }).status || 500;
    proxmoxLogger.error("Proxmox sync failed", err, {
      operation: "proxmox_sync",
      hostId: parsedHostId,
      userId,
    });
    return res.status(status).json({ error: `Sync failed: ${message}` });
  }
});

async function runDueProxmoxAutoSyncs(): Promise<void> {
  try {
    const rows = await createCurrentHostRepository().listProxmoxEnabled();

    const now = Date.now();
    for (const row of rows) {
      const configRaw = parseJsonObject(row.proxmoxConfig);
      const config = parseProxmoxConfig(configRaw);
      if (!config.autoSyncEnabled) continue;
      if (!DataCrypto.canUserAccessData(row.userId)) continue;

      const lastSyncAt =
        typeof configRaw.lastSyncAt === "string"
          ? Date.parse(configRaw.lastSyncAt)
          : 0;
      const intervalMs = config.syncIntervalMinutes * 60 * 1000;
      if (lastSyncAt && now - lastSyncAt < intervalMs) continue;

      syncProxmoxHost(row.userId, row.id).catch((error) => {
        proxmoxLogger.error("Scheduled Proxmox sync failed", error, {
          operation: "proxmox_auto_sync",
          hostId: row.id,
          userId: row.userId,
        });
      });
    }
  } catch (error) {
    proxmoxLogger.error("Failed to scan Proxmox auto sync jobs", error, {
      operation: "proxmox_auto_sync_scan",
    });
  }
}

const proxmoxAutoSyncTimer = setInterval(runDueProxmoxAutoSyncs, 60 * 1000);
proxmoxAutoSyncTimer.unref?.();
const proxmoxAutoSyncStartupTimer = setTimeout(
  runDueProxmoxAutoSyncs,
  30 * 1000,
);
proxmoxAutoSyncStartupTimer.unref?.();

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
      const discovery = await discoverProxmoxGuestsForHost(
        userId,
        parsedHostId,
      );
      return res.json({
        guests: discovery.guests,
        credentialId: discovery.credentialId,
        defaultCredentialId: discovery.defaultCredentialId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      proxmoxLogger.error("Proxmox discovery failed", err, {
        operation: "proxmox_discover",
        hostId: parsedHostId,
        userId,
      });

      const status =
        (err as Error & { code?: string; status?: number }).code ===
        "SESSION_EXPIRED"
          ? 401
          : (err as Error & { status?: number }).status ||
            (message.includes("Authentication failed") ||
            message.includes("connect ECONNREFUSED") ||
            message.includes("connect ETIMEDOUT")
              ? 422
              : 500);
      return res.status(status).json({ error: `Discovery failed: ${message}` });
    }
  },
);

export default router;
