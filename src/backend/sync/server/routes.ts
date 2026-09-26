import express, { type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import * as tar from "tar";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { syncLogger } from "../../utils/logger.js";
import { getLocalVersion } from "../../utils/app-version.js";
import { getEntity, listEntities } from "../../plugins/sync-registry.js";
import { getPluginRuntime } from "../../plugins/index.js";
import {
  createCurrentSessionRepository,
  createCurrentSettingsRepository,
  createCurrentUserRepository,
  createCurrentPluginRepository,
  createCurrentPluginPermissionGrantRepository,
} from "../../database/repositories/factory.js";
import { resolveBrandingSettings } from "../../database/routes/branding-settings.js";
import { registerCoreSyncEntities } from "../entities.js";
import { listChanges, recordKey } from "../records.js";
import { addListener, reconcileUser, withUserLock } from "./feed.js";
import { applyPush, parsePushOps } from "./push.js";
import { SYNC_PROTOCOL_VERSION } from "../protocol.js";

const SESSION_DAYS = 365;
const REFRESH_WITHIN_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_PAGE = 1000;

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

registerCoreSyncEntities();

function userOf(req: Request): string {
  return (req as AuthenticatedRequest).userId;
}

/**
 * @openapi
 * /sync/v2/info:
 *   get:
 *     summary: Describe this server to a desktop that wants to link to it
 *     description: Public. Lets the desktop app confirm it reached Termix and not a proxy's login page, and that the sync protocol matches.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: Server name, version and sync protocol version.
 */
router.get("/v2/info", async (_req: Request, res: Response) => {
  let name = "Termix";
  try {
    name = (await resolveBrandingSettings(createCurrentSettingsRepository()))
      .appName;
  } catch {
    // The default name is fine.
  }
  res.setHeader("X-Termix-Sync", String(SYNC_PROTOCOL_VERSION));
  res.json({
    termix: true,
    name,
    version: getLocalVersion(),
    protocol: SYNC_PROTOCOL_VERSION,
  });
});

/**
 * @openapi
 * /sync/v2/link:
 *   post:
 *     summary: Link a desktop to this account
 *     description: Trades the short login session the desktop just signed in with for a long-lived desktop session, which shows in the account's sessions list and is revoked like any other. The login session is ended.
 *     tags:
 *       - Sync
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deviceName:
 *                 type: string
 *     responses:
 *       200:
 *         description: The desktop session token and the account it belongs to.
 *       401:
 *         description: Not signed in.
 */
router.post(
  "/v2/link",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = userOf(req);
    try {
      const user = await createCurrentUserRepository().findById(userId);
      if (!user) return res.status(401).json({ error: "User not found" });
      const rawName =
        typeof req.body?.deviceName === "string" ? req.body.deviceName : "";
      const deviceName = rawName.trim().slice(0, 100) || "Termix Desktop";
      const token = await authManager.generateJWTToken(userId, {
        expiresIn: `${SESSION_DAYS}d`,
        deviceType: "desktop",
        deviceInfo: `${deviceName} (sync)`,
      });
      const loginSession = (req as AuthenticatedRequest).sessionId;
      if (loginSession) await authManager.revokeSession(loginSession);
      res.json({
        token,
        user: { id: user.id, username: user.username },
        server: { version: getLocalVersion() },
      });
    } catch (error) {
      syncLogger.error("Failed to link a desktop", error, {
        operation: "sync_link",
        userId,
      });
      res.status(500).json({ error: "Failed to link" });
    }
  },
);

/**
 * @openapi
 * /sync/v2/session/refresh:
 *   post:
 *     summary: Keep a linked desktop's session from expiring
 *     description: Returns a fresh desktop session when the current one ends within 60 days, and ends the old one. Otherwise returns null and the desktop keeps its token.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The new token, or null.
 *       401:
 *         description: Session revoked or expired.
 */
router.post(
  "/v2/session/refresh",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = userOf(req);
    const sessionId = (req as AuthenticatedRequest).sessionId;
    try {
      if (!sessionId) return res.json({ token: null });
      const session =
        await createCurrentSessionRepository().findById(sessionId);
      if (!session) return res.status(401).json({ error: "Session not found" });
      const remaining = new Date(session.expiresAt).getTime() - Date.now();
      if (remaining > REFRESH_WITHIN_MS) return res.json({ token: null });
      const token = await authManager.generateJWTToken(userId, {
        expiresIn: `${SESSION_DAYS}d`,
        deviceType: "desktop",
        deviceInfo: session.deviceInfo,
      });
      await authManager.revokeSession(sessionId);
      res.json({ token });
    } catch (error) {
      syncLogger.error("Failed to refresh a desktop session", error, {
        operation: "sync_session_refresh",
        userId,
      });
      res.status(500).json({ error: "Failed to refresh session" });
    }
  },
);

/**
 * @openapi
 * /sync/v2/unlink:
 *   post:
 *     summary: End a linked desktop's session
 *     description: Called by a desktop when it unlinks, so its session stops working here right away.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The session was ended.
 */
router.post(
  "/v2/unlink",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const sessionId = (req as AuthenticatedRequest).sessionId;
    try {
      if (sessionId) await authManager.revokeSession(sessionId);
      res.json({ success: true });
    } catch (error) {
      syncLogger.error("Failed to end a desktop session", error, {
        operation: "sync_unlink",
      });
      res.status(500).json({ error: "Failed to unlink" });
    }
  },
);

/**
 * @openapi
 * /sync/v2/changes:
 *   get:
 *     summary: Pull what changed for this account after a cursor
 *     description: Returns records in change order. Each has the entity type, syncId, revision, whether it is deleted, and the row when it is not. Records of entity types this server does not currently run are skipped but still move the cursor.
 *     tags:
 *       - Sync
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: types
 *         description: Comma-separated entity types, to backfill only those.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A page of changes, the next cursor and whether more remain.
 *       500:
 *         description: Failed to read changes.
 */
router.get(
  "/v2/changes",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = userOf(req);
    const cursor = Math.max(0, Number(req.query.cursor) || 0);
    const limit = Math.min(
      MAX_PAGE,
      Math.max(1, Number(req.query.limit) || MAX_PAGE),
    );
    const types =
      typeof req.query.types === "string" && req.query.types
        ? req.query.types.split(",").filter(Boolean)
        : undefined;

    try {
      const page = await withUserLock(userId, async () => {
        const { wire } = await reconcileUser(userId);
        const records = await listChanges(userId, cursor, limit + 1, types);
        return { wire, records };
      });
      const hasMore = page.records.length > limit;
      const records = page.records.slice(0, limit);
      const changes = [];
      for (const record of records) {
        if (!getEntity(record.entityType)) continue;
        const row = record.deleted
          ? null
          : (page.wire.get(recordKey(record.entityType, record.syncId)) ??
            null);
        // A live record with no row failed to serialize; it comes again once it
        // changes, rather than arriving as a delete.
        if (!record.deleted && !row) continue;
        changes.push({
          seq: record.seq,
          entityType: record.entityType,
          syncId: record.syncId,
          revision: record.revision,
          deleted: !!record.deleted,
          row,
        });
      }
      res.json({
        changes,
        nextCursor: records.length ? records[records.length - 1].seq : cursor,
        hasMore,
        entityTypes: listEntities().map((entity) => ({
          type: entity.type,
          owner: entity.owner,
          order: entity.order,
          readOnly: !!entity.readOnly,
        })),
      });
    } catch (error) {
      syncLogger.error("Failed to read sync changes", error, {
        operation: "sync_changes",
        userId,
      });
      res.status(500).json({ error: "Failed to read changes" });
    }
  },
);

/**
 * @openapi
 * /sync/v2/push:
 *   post:
 *     summary: Push a desktop's changes
 *     description: Each op carries the revision the desktop last saw. Ops are applied in dependency order and each gets its own result, ok with the new revision, conflict with the server's version, or rejected with a reason.
 *     tags:
 *       - Sync
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ops:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: One result per op, in the order sent.
 *       400:
 *         description: Malformed ops, or more than 500.
 *       500:
 *         description: Failed to apply changes.
 */
router.post(
  "/v2/push",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = userOf(req);
    const ops = parsePushOps(req.body);
    if (!ops) return res.status(400).json({ error: "Invalid ops" });
    try {
      const results = await withUserLock(userId, () => applyPush(userId, ops));
      res.json({ results });
    } catch (error) {
      syncLogger.error("Failed to apply pushed changes", error, {
        operation: "sync_push",
        userId,
      });
      res.status(500).json({ error: "Failed to apply changes" });
    }
  },
);

/**
 * @openapi
 * /sync/v2/events:
 *   get:
 *     summary: Stream a notice whenever this account's data changes
 *     description: Server-sent events. A "change" event means there is something new to pull. Comments are sent every 25 seconds to keep proxies from closing the stream.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: An event stream.
 */
router.get("/v2/events", authenticateJWT, (req: Request, res: Response) => {
  const userId = userOf(req);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`event: ready\ndata: {}\n\n`);
  const remove = addListener(userId, res);
  req.on("close", remove);
});

/**
 * @openapi
 * /sync/v2/hosts/{syncId}:
 *   get:
 *     summary: This server's id for a host, by its sync id
 *     description: For a linked desktop that asks the server to act on a host (a tunnel through it), which needs the server's own id. Only for hosts the caller can see.
 *     tags:
 *       - Sync
 *     parameters:
 *       - in: path
 *         name: syncId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The host's id and name.
 *       404:
 *         description: No such host the caller can see.
 */
router.get(
  "/v2/hosts/:syncId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = userOf(req);
    try {
      const { createCurrentHostResolutionRepository } =
        await import("../../database/repositories/factory.js");
      const hostId =
        await createCurrentHostResolutionRepository().findHostIdBySyncId(
          String(req.params.syncId),
        );
      if (hostId === null) return res.status(404).json({ error: "Not found" });
      const { PermissionManager } =
        await import("../../utils/permission-manager.js");
      const access = await PermissionManager.getInstance().canAccessHost(
        userId,
        hostId,
        "view",
      );
      if (!access.hasAccess)
        return res.status(404).json({ error: "Not found" });
      const { createCurrentHostRepository } =
        await import("../../database/repositories/factory.js");
      const row = await createCurrentHostRepository().findById(hostId);
      res.json({ id: hostId, name: row?.name ?? row?.ip ?? null });
    } catch (error) {
      syncLogger.error("Failed to look up a host by sync id", error, {
        operation: "sync_host_lookup",
      });
      res.status(500).json({ error: "Failed to look up host" });
    }
  },
);

/**
 * @openapi
 * /sync/v2/host-status:
 *   get:
 *     summary: Status of the hosts this account can see, keyed by sync id
 *     description: For a linked desktop whose hosts connect through this server, so it can show their status against its own copies.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: Status entries by host sync id.
 */
router.get(
  "/v2/host-status",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = userOf(req);
    try {
      const { hostStatusService } =
        await import("../../hosts/status/host-status-service.js");
      const { PermissionManager } =
        await import("../../utils/permission-manager.js");
      const { createCurrentHostRepository } =
        await import("../../database/repositories/factory.js");
      const statuses = await hostStatusService.statusesFor(userId, null);
      const entries = [...statuses.entries()];
      const allowed =
        await PermissionManager.getInstance().filterAccessibleHostIds(
          userId,
          entries.map(([id]) => id),
        );
      const hostRepository = createCurrentHostRepository();
      const result: Record<string, unknown> = {};
      for (const [id, entry] of entries) {
        if (!allowed.has(id)) continue;
        const row = await hostRepository.findById(id);
        if (row?.syncId) result[row.syncId] = entry;
      }
      res.json(result);
    } catch (error) {
      syncLogger.error("Failed to read host status for sync", error, {
        operation: "sync_host_status",
      });
      res.status(500).json({ error: "Failed to read host status" });
    }
  },
);

async function listPluginsForDesktop() {
  return getPluginRuntime().loader.list();
}

/**
 * @openapi
 * /sync/v2/plugins:
 *   get:
 *     summary: The features this server runs, for a linked desktop to mirror
 *     description: Every installed plugin with its version, where it came from, whether it is on, how a desktop should treat it and which sync entities it owns.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The plugin list.
 */
router.get(
  "/v2/plugins",
  authenticateJWT,
  async (_req: Request, res: Response) => {
    try {
      const records = new Map(
        (await createCurrentPluginRepository().listAll()).map((record) => [
          record.id,
          record,
        ]),
      );
      const grants = createCurrentPluginPermissionGrantRepository();
      const plugins = [];
      for (const plugin of await listPluginsForDesktop()) {
        plugins.push({
          id: plugin.id,
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          source: plugin.source,
          enabled: records.get(plugin.id)?.state === "enabled",
          active: plugin.state === "active",
          desktop: plugin.manifest.desktop ?? "mirror",
          syncEntities: plugin.manifest.contributes?.syncEntities ?? [],
          granted: (await grants.listByPlugin(plugin.id)).map(
            (grant) => grant.capability,
          ),
        });
      }
      res.json({ plugins });
    } catch (error) {
      syncLogger.error("Failed to list plugins for sync", error, {
        operation: "sync_plugins",
      });
      res.status(500).json({ error: "Failed to list plugins" });
    }
  },
);

/**
 * @openapi
 * /sync/v2/plugins/{id}/package:
 *   get:
 *     summary: Download an installed plugin so a linked desktop can install it
 *     description: Only for plugins installed on this server, not bundled ones. Sends the original .tmxplug when there is one, with its signature in the X-Termix-Signature header, otherwise a fresh archive of the plugin folder.
 *     tags:
 *       - Sync
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The plugin archive.
 *       404:
 *         description: No installed plugin with that id.
 */
router.get(
  "/v2/plugins/:id/package",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const pluginId = String(req.params.id);
    try {
      const plugin = (await listPluginsForDesktop()).find(
        (candidate) => candidate.id === pluginId,
      );
      if (!plugin || plugin.source !== "user") {
        return res.status(404).json({ error: "Plugin not found" });
      }
      const { getPluginsDir } = await import("../../plugins/paths.js");
      const artifact = path.join(getPluginsDir(), `${pluginId}.tmxplug`);
      res.setHeader("Content-Type", "application/gzip");
      if (fs.existsSync(artifact)) {
        const sig = `${artifact}.sig`;
        if (fs.existsSync(sig)) {
          res.setHeader(
            "X-Termix-Signature",
            Buffer.from(await fs.promises.readFile(sig, "utf8")).toString(
              "base64",
            ),
          );
        }
        return fs.createReadStream(artifact).pipe(res);
      }
      const temp = path.join(
        os.tmpdir(),
        `termix-plugin-${pluginId}-${Date.now()}.tmxplug`,
      );
      await tar.c({ gzip: true, cwd: plugin.dir, file: temp }, ["."]);
      const stream = fs.createReadStream(temp);
      stream.on("close", () => void fs.promises.rm(temp, { force: true }));
      stream.pipe(res);
    } catch (error) {
      syncLogger.error("Failed to package a plugin for sync", error, {
        operation: "sync_plugin_package",
        pluginId,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to package plugin" });
      }
    }
  },
);

export default router;
