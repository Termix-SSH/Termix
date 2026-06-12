import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { sshLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { hosts, sshCredentials } from "../db/schema.js";
import {
  isNonEmptyString,
  isValidPort,
  normalizeImportedHost,
} from "./host-normalizers.js";

export function registerHostBulkRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /host/bulk-import:
   *   post:
   *     summary: Bulk import SSH hosts
   *     description: Bulk imports multiple SSH hosts.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hosts:
   *                 type: array
   *                 items:
   *                   type: object
   *     responses:
   *       200:
   *         description: Import completed.
   *       400:
   *         description: Invalid request body.
   */

  /**
   * @swagger
   * /host/bulk-update:
   *   patch:
   *     summary: Bulk update partial fields on multiple SSH hosts
   *     tags: [SSH]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostIds:
   *                 type: array
   *                 items:
   *                   type: number
   *               updates:
   *                 type: object
   *     responses:
   *       200:
   *         description: Bulk update completed.
   *       400:
   *         description: Invalid request body.
   */
  router.patch(
    "/bulk-update",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hostIds, updates } = req.body;

      if (!Array.isArray(hostIds) || hostIds.length === 0) {
        return res
          .status(400)
          .json({ error: "hostIds array is required and must not be empty" });
      }

      if (hostIds.length > 1000) {
        return res
          .status(400)
          .json({ error: "Maximum 1000 hosts allowed per bulk update" });
      }

      if (
        !updates ||
        typeof updates !== "object" ||
        Object.keys(updates).length === 0
      ) {
        return res.status(400).json({
          error:
            "updates object is required and must contain at least one field",
        });
      }

      try {
        const ownedHosts = await db
          .select({
            id: hosts.id,
            statsConfig: hosts.statsConfig,
            credentialId: hosts.credentialId,
            proxmoxConfig: hosts.proxmoxConfig,
          })
          .from(hosts)
          .where(and(inArray(hosts.id, hostIds), eq(hosts.userId, userId)));

        const ownedIds = ownedHosts.map((h) => h.id);
        const unauthorizedIds = hostIds.filter(
          (id: number) => !ownedIds.includes(id),
        );

        if (ownedIds.length === 0) {
          return res.status(404).json({ error: "No matching hosts found" });
        }

        const errors: string[] = [];
        if (unauthorizedIds.length > 0) {
          errors.push(
            `${unauthorizedIds.length} host(s) not found or not owned`,
          );
        }

        const simpleUpdates: Record<string, unknown> = {};
        if (typeof updates.pin === "boolean") simpleUpdates.pin = updates.pin;
        if (typeof updates.folder === "string")
          simpleUpdates.folder = updates.folder || null;
        if (typeof updates.enableTerminal === "boolean")
          simpleUpdates.enableTerminal = updates.enableTerminal;
        if (typeof updates.enableTunnel === "boolean")
          simpleUpdates.enableTunnel = updates.enableTunnel;
        if (typeof updates.enableFileManager === "boolean")
          simpleUpdates.enableFileManager = updates.enableFileManager;
        if (typeof updates.enableDocker === "boolean")
          simpleUpdates.enableDocker = updates.enableDocker;
        if (typeof updates.enableTmuxMonitor === "boolean")
          simpleUpdates.enableTmuxMonitor = updates.enableTmuxMonitor;
        // Disabling Proxmox is a plain flag flip; enabling is handled per-host
        // below so each host can default to its own stored credential.
        if (updates.enableProxmox === false)
          simpleUpdates.enableProxmox = false;

        if (Object.keys(simpleUpdates).length > 0) {
          await db
            .update(hosts)
            .set(simpleUpdates)
            .where(and(inArray(hosts.id, ownedIds), eq(hosts.userId, userId)));
        }

        if (updates.statsConfig && typeof updates.statsConfig === "object") {
          for (const host of ownedHosts) {
            try {
              const existing = host.statsConfig
                ? JSON.parse(host.statsConfig as string)
                : {};
              const merged = { ...existing, ...updates.statsConfig };
              await db
                .update(hosts)
                .set({ statsConfig: JSON.stringify(merged) })
                .where(and(eq(hosts.id, host.id), eq(hosts.userId, userId)));
            } catch {
              errors.push(`Failed to update statsConfig for host ${host.id}`);
            }
          }
        }

        // Enabling Proxmox needs per-host handling: each host defaults its
        // Proxmox credential to the credential already stored on that host, so
        // discovery works right away without picking one by hand. Existing
        // proxmoxConfig values are preserved.
        if (updates.enableProxmox === true) {
          for (const host of ownedHosts) {
            try {
              const existing = host.proxmoxConfig
                ? JSON.parse(host.proxmoxConfig as string)
                : {};
              const merged = {
                defaultCredentialId:
                  existing.defaultCredentialId ?? host.credentialId ?? null,
                windowsPatterns: existing.windowsPatterns ?? "win, windows",
                dockerPatterns: existing.dockerPatterns ?? "docker",
                preferredPrefixes:
                  existing.preferredPrefixes ?? "10., 192.168.",
              };
              await db
                .update(hosts)
                .set({
                  enableProxmox: true,
                  proxmoxConfig: JSON.stringify(merged),
                })
                .where(and(eq(hosts.id, host.id), eq(hosts.userId, userId)));
            } catch {
              errors.push(`Failed to enable Proxmox for host ${host.id}`);
            }
          }
        }

        DatabaseSaveTrigger.triggerSave("bulk_update");

        return res.json({
          updated: ownedIds.length,
          failed: unauthorizedIds.length,
          errors,
        });
      } catch (error) {
        sshLogger.error("Failed to bulk update hosts:", error);
        return res.status(500).json({ error: "Failed to bulk update hosts" });
      }
    },
  );

  router.post(
    "/bulk-import",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { hosts: hostsToImport, overwrite } = req.body;

      if (!Array.isArray(hostsToImport) || hostsToImport.length === 0) {
        return res
          .status(400)
          .json({ error: "Hosts array is required and must not be empty" });
      }

      if (hostsToImport.length > 100) {
        return res
          .status(400)
          .json({ error: "Maximum 100 hosts allowed per import" });
      }

      const results = {
        success: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: [] as string[],
      };

      let existingHostMap: Map<string, { id: number }> | undefined;
      if (overwrite) {
        try {
          const allHosts = await SimpleDBOps.select<Record<string, unknown>>(
            db.select().from(hosts).where(eq(hosts.userId, userId)),
            "ssh_data",
            userId,
          );
          existingHostMap = new Map();
          for (const h of allHosts) {
            const key = `${h.ip}:${h.port}:${h.username}`;
            existingHostMap.set(key, { id: h.id as number });
          }
        } catch {
          existingHostMap = undefined;
        }
      }

      for (let i = 0; i < hostsToImport.length; i++) {
        const hostData = normalizeImportedHost(hostsToImport[i]);

        try {
          const effectiveConnectionType = hostData.connectionType || "ssh";

          if (!isNonEmptyString(hostData.ip) || !isValidPort(hostData.port)) {
            results.failed++;
            results.errors.push(
              `Host ${i + 1}: Missing required fields (ip, port)`,
            );
            continue;
          }

          if (
            effectiveConnectionType === "ssh" &&
            !isNonEmptyString(hostData.username)
          ) {
            results.failed++;
            results.errors.push(
              `Host ${i + 1}: Username required for SSH connections`,
            );
            continue;
          }

          if (
            effectiveConnectionType === "ssh" &&
            hostData.authType &&
            ![
              "password",
              "key",
              "credential",
              "none",
              "opkssh",
              "tailscale",
            ].includes(hostData.authType)
          ) {
            results.failed++;
            results.errors.push(
              `Host ${i + 1}: Invalid authType. Must be 'password', 'key', 'credential', 'none', 'opkssh', or 'tailscale'`,
            );
            continue;
          }

          if (
            effectiveConnectionType === "ssh" &&
            hostData.authType === "password" &&
            !isNonEmptyString(hostData.password)
          ) {
            results.failed++;
            results.errors.push(
              `Host ${i + 1}: Password required for password authentication`,
            );
            continue;
          }

          if (
            effectiveConnectionType === "ssh" &&
            hostData.authType === "key" &&
            !isNonEmptyString(hostData.key)
          ) {
            results.failed++;
            results.errors.push(
              `Host ${i + 1}: Key required for key authentication`,
            );
            continue;
          }

          if (
            effectiveConnectionType === "ssh" &&
            hostData.authType === "credential" &&
            !hostData.credentialId
          ) {
            results.failed++;
            results.errors.push(
              `Host ${i + 1}: credentialId required for credential authentication`,
            );
            continue;
          }

          if (
            effectiveConnectionType === "ssh" &&
            hostData.authType === "credential" &&
            hostData.credentialId
          ) {
            const cred = await db
              .select({ id: sshCredentials.id })
              .from(sshCredentials)
              .where(
                and(
                  eq(sshCredentials.id, hostData.credentialId),
                  eq(sshCredentials.userId, userId),
                ),
              )
              .limit(1);

            if (cred.length === 0) {
              const fallback = await db
                .select({ id: sshCredentials.id })
                .from(sshCredentials)
                .where(eq(sshCredentials.userId, userId))
                .limit(1);

              if (fallback.length > 0) {
                hostData.credentialId = fallback[0].id;
              } else {
                results.failed++;
                results.errors.push(
                  `Host ${i + 1}: credentialId ${hostData.credentialId} not found and no fallback credential available`,
                );
                continue;
              }
            }
          }

          const sshDataObj: Record<string, unknown> = {
            userId: userId,
            connectionType: effectiveConnectionType,
            name: hostData.name || `${hostData.username || ""}@${hostData.ip}`,
            folder: hostData.folder || "Default",
            tags: Array.isArray(hostData.tags) ? hostData.tags.join(",") : "",
            ip: hostData.ip,
            port: hostData.port,
            username: hostData.username || null,
            pin: hostData.pin || false,
            enableTerminal: hostData.enableTerminal !== false,
            enableTunnel: hostData.enableTunnel !== false,
            enableFileManager: hostData.enableFileManager !== false,
            enableDocker: hostData.enableDocker || false,
            enableProxmox: hostData.enableProxmox || false,
            enableTmuxMonitor: hostData.enableTmuxMonitor || false,
            showTerminalInSidebar: hostData.showTerminalInSidebar ? 1 : 0,
            showFileManagerInSidebar: hostData.showFileManagerInSidebar ? 1 : 0,
            showTunnelInSidebar: hostData.showTunnelInSidebar ? 1 : 0,
            showDockerInSidebar: hostData.showDockerInSidebar ? 1 : 0,
            showServerStatsInSidebar: hostData.showServerStatsInSidebar ? 1 : 0,
            defaultPath: hostData.defaultPath || "/",
            sudoPassword: hostData.sudoPassword || null,
            tunnelConnections: hostData.tunnelConnections
              ? JSON.stringify(hostData.tunnelConnections)
              : "[]",
            jumpHosts: hostData.jumpHosts
              ? JSON.stringify(hostData.jumpHosts)
              : null,
            quickActions: hostData.quickActions
              ? JSON.stringify(hostData.quickActions)
              : null,
            statsConfig: hostData.statsConfig
              ? JSON.stringify(hostData.statsConfig)
              : null,
            dockerConfig: hostData.dockerConfig
              ? JSON.stringify(hostData.dockerConfig)
              : null,
            proxmoxConfig: hostData.proxmoxConfig
              ? JSON.stringify(hostData.proxmoxConfig)
              : null,
            terminalConfig: hostData.terminalConfig
              ? JSON.stringify(hostData.terminalConfig)
              : null,
            forceKeyboardInteractive: hostData.forceKeyboardInteractive
              ? "true"
              : "false",
            notes: hostData.notes || null,
            useSocks5: hostData.useSocks5 ? 1 : 0,
            socks5Host: hostData.socks5Host || null,
            socks5Port: hostData.socks5Port || null,
            socks5Username: hostData.socks5Username || null,
            socks5Password: hostData.socks5Password || null,
            socks5ProxyChain: hostData.socks5ProxyChain
              ? JSON.stringify(hostData.socks5ProxyChain)
              : null,
            portKnockSequence: hostData.portKnockSequence
              ? JSON.stringify(hostData.portKnockSequence)
              : null,
            overrideCredentialUsername: hostData.overrideCredentialUsername
              ? 1
              : 0,
            enableSsh: hostData.enableSsh ?? effectiveConnectionType === "ssh",
            enableRdp: hostData.enableRdp ?? false,
            enableVnc: hostData.enableVnc ?? false,
            enableTelnet: hostData.enableTelnet ?? false,
            updatedAt: new Date().toISOString(),
          };

          if (effectiveConnectionType !== "ssh") {
            sshDataObj.password = hostData.password || null;
            sshDataObj.authType = "password";
            sshDataObj.credentialId = null;
            sshDataObj.key = null;
            sshDataObj.keyPassword = null;
            sshDataObj.keyType = null;
            sshDataObj.rdpUser = hostData.rdpUser || null;
            sshDataObj.rdpPassword = hostData.rdpPassword || null;
            sshDataObj.rdpDomain = hostData.rdpDomain || null;
            sshDataObj.rdpSecurity = hostData.rdpSecurity || null;
            sshDataObj.rdpIgnoreCert = hostData.rdpIgnoreCert ? 1 : 0;
            sshDataObj.rdpPort = hostData.rdpPort || 3389;
            sshDataObj.vncUser = hostData.vncUser || null;
            sshDataObj.vncPassword = hostData.vncPassword || null;
            sshDataObj.vncPort = hostData.vncPort || 5900;
            sshDataObj.telnetUser = hostData.telnetUser || null;
            sshDataObj.telnetPassword = hostData.telnetPassword || null;
            sshDataObj.telnetPort = hostData.telnetPort || 23;
            sshDataObj.enableRdp = hostData.enableRdp ? 1 : 0;
            sshDataObj.enableVnc = hostData.enableVnc ? 1 : 0;
            sshDataObj.enableTelnet = hostData.enableTelnet ? 1 : 0;
            sshDataObj.guacamoleConfig = hostData.guacamoleConfig
              ? JSON.stringify(hostData.guacamoleConfig)
              : null;
          } else {
            sshDataObj.password =
              hostData.authType === "password" ? hostData.password : null;
            sshDataObj.authType = hostData.authType || "password";
            sshDataObj.credentialId =
              hostData.authType === "credential" ? hostData.credentialId : null;
            sshDataObj.key = hostData.authType === "key" ? hostData.key : null;
            sshDataObj.keyPassword =
              hostData.authType === "key" ? hostData.keyPassword || null : null;
            sshDataObj.keyType =
              hostData.authType === "key" ? hostData.keyType || "auto" : null;
            sshDataObj.domain = null;
            sshDataObj.security = null;
            sshDataObj.ignoreCert = 0;
            sshDataObj.guacamoleConfig = null;
          }

          const lookupKey = `${hostData.ip}:${hostData.port}:${hostData.username}`;
          const existing = existingHostMap?.get(lookupKey);

          if (existing) {
            await SimpleDBOps.update(
              hosts,
              "ssh_data",
              eq(hosts.id, existing.id),
              sshDataObj,
              userId,
            );
            results.updated++;
          } else {
            sshDataObj.createdAt = new Date().toISOString();
            await SimpleDBOps.insert(hosts, "ssh_data", sshDataObj, userId);
            results.success++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }

      res.json({
        message: `Import completed: ${results.success} created, ${results.updated} updated, ${results.failed} failed`,
        success: results.success,
        updated: results.updated,
        skipped: results.skipped,
        failed: results.failed,
        errors: results.errors,
      });
    },
  );
}
