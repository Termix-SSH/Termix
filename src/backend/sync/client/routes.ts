/**
 * The desktop's own sync routes, under /sync/link. They only exist in the
 * embedded desktop backend; on a server they answer 404.
 */

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import type { SyncRow } from "@termix/plugin-sdk/backend";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { syncLogger } from "../../utils/logger.js";
import { hosts, sshCredentials } from "../../database/db/schema.js";
import { createCurrentRepositoryContext } from "../../database/repositories/factory.js";
import { getPluginRuntime } from "../../plugins/index.js";
import { getEntity, listEntities } from "../../plugins/sync-registry.js";
import { registerCoreSyncEntities } from "../entities.js";
import {
  createResolvers,
  deleteStoredRow,
  listStoredRows,
  regenerateSyncIds,
  writeWireRow,
} from "../store.js";
import {
  clearRecordErrors,
  deleteConflict,
  deleteRecordsForUser,
  getConflict,
  listConflicts,
  listRecordErrors,
} from "../records.js";
import { SYNC_PROTOCOL_VERSION } from "../protocol.js";
import {
  createLink,
  deleteLink,
  getLink,
  updateLink,
  type BasicAuth,
  type ProxyHeader,
  type SyncLink,
} from "./link-store.js";
import {
  normalizeServerUrl,
  RemoteError,
  remoteJson,
  type RemoteTarget,
} from "./http.js";
import { defaultDeviceName, getSyncEngine } from "./engine.js";
import { applyElectronProxyConfig } from "./electron-proxy.js";
import { lastRemotePlugins } from "./plugins.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

function desktopOnly(_req: Request, res: Response, next: NextFunction) {
  if (process.env.ELECTRON_EMBEDDED !== "true") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

const guard = [desktopOnly, authenticateJWT];

function userOf(req: Request): string {
  return (req as AuthenticatedRequest).userId;
}

function readHeaders(value: unknown): ProxyHeader[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (header): header is ProxyHeader =>
        !!header &&
        typeof header.name === "string" &&
        typeof header.value === "string" &&
        /^[A-Za-z0-9-]{1,100}$/.test(header.name.trim()),
    )
    .map((header) => ({ name: header.name.trim(), value: header.value }))
    .slice(0, 20);
}

function readBasicAuth(value: unknown): BasicAuth | null {
  if (!value || typeof value !== "object") return null;
  const { username, password } = value as Record<string, unknown>;
  if (typeof username !== "string" || !username) return null;
  return {
    username,
    password: typeof password === "string" ? password : "",
  };
}

function readTarget(body: Record<string, unknown>): RemoteTarget | null {
  const serverUrl =
    typeof body.serverUrl === "string"
      ? normalizeServerUrl(body.serverUrl)
      : null;
  if (!serverUrl) return null;
  return {
    serverUrl,
    customHeaders: readHeaders(body.customHeaders),
    basicAuth: readBasicAuth(body.basicAuth),
    allowInvalidCertificate: body.allowInvalidCertificate === true,
  };
}

/** What the sync panel can show about each entity type. */
function describeEntities(link: SyncLink | null) {
  registerCoreSyncEntities();
  const names = new Map<string, string>();
  for (const plugin of getPluginRuntime().loader.list()) {
    names.set(plugin.id, plugin.manifest.name);
  }
  for (const plugin of lastRemotePlugins()) {
    if (!names.has(plugin.id)) names.set(plugin.id, plugin.name);
  }
  const serverTypes = getSyncEngine().state.serverTypes;
  const seen = new Set<string>();
  const entries = [
    ...listEntities().map((entity) => ({
      type: entity.type,
      owner: entity.owner,
      readOnly: !!entity.readOnly,
    })),
    ...serverTypes,
  ];
  return entries
    .filter((entry) => {
      if (seen.has(entry.type) || entry.type === "accountProfile") return false;
      seen.add(entry.type);
      return true;
    })
    .map((entry) => ({
      type: entry.type,
      owner: entry.owner,
      ownerName:
        entry.owner === "core" ? null : (names.get(entry.owner) ?? entry.owner),
      readOnly: entry.readOnly,
      onServer: serverTypes.some((server) => server.type === entry.type),
      onDevice: !!getEntity(entry.type),
      enabled: !link?.disabledTypes.includes(entry.type),
    }));
}

async function statusBody() {
  const link = await getLink();
  const engine = getSyncEngine();
  if (!link) {
    return { linked: false, entities: describeEntities(null) };
  }
  return {
    linked: true,
    serverUrl: link.serverUrl,
    serverName: link.serverName,
    serverVersion: link.serverVersion,
    account: link.account ?? {
      username: link.remoteUsername ?? undefined,
    },
    status: engine.state.running ? "syncing" : link.status,
    lastError: link.lastError,
    linkedAt: link.linkedAt,
    lastSyncAt: link.lastSyncAt,
    pending: engine.state.pending,
    conflicts: (await listConflicts(link.userId)).length,
    errors: (await listRecordErrors(link.userId)).length,
    firstSyncDone: link.knownTypes.length > 0,
    allowInvalidCertificate: link.allowInvalidCertificate,
    customHeaders: link.customHeaders.map((header) => ({
      name: header.name,
      value: "",
      set: true,
    })),
    basicAuth: link.basicAuth
      ? { username: link.basicAuth.username, password: "", set: true }
      : null,
    entities: describeEntities(link),
  };
}

/** Removes read-only copies of what other users shared with the account. */
async function removeSharedCopies(userId: string): Promise<void> {
  const db = createCurrentRepositoryContext().drizzle;
  const sharedHosts = await db
    .select({ id: hosts.id })
    .from(hosts)
    .where(and(eq(hosts.userId, userId), isNotNull(hosts.sharedSource)));
  const { deleteOwnedHost } = await import("../../hosts/delete-host.js");
  for (const host of sharedHosts) await deleteOwnedHost(userId, host.id);

  const sharedCredentials = await db
    .select({ id: sshCredentials.id })
    .from(sshCredentials)
    .where(
      and(
        eq(sshCredentials.userId, userId),
        isNotNull(sshCredentials.sharedSource),
      ),
    );
  const { deleteOwnedCredential } =
    await import("../../hosts/delete-credential.js");
  for (const credential of sharedCredentials) {
    await deleteOwnedCredential(userId, credential.id);
  }
}

/** Deletes every row that syncs, keeping local-only ones. */
async function wipeSyncedData(userId: string): Promise<void> {
  const entities = [...listEntities()].reverse();
  for (const entity of entities) {
    if (entity.readOnly) continue;
    try {
      if (entity.load) {
        for (const row of await entity.load(userId)) {
          await entity.erase?.(userId, String(row.syncId));
        }
        continue;
      }
      if (!entity.table || entity.singleton) continue;
      for (const row of await listStoredRows(entity, userId)) {
        if (entity.shouldSync && entity.shouldSync(row) === false) continue;
        if (typeof row.syncId !== "string") continue;
        await deleteStoredRow(entity, userId, row.syncId);
      }
    } catch (error) {
      syncLogger.warn("Could not clear synced data", {
        operation: "sync_wipe",
        entityType: entity.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function problemFor(error: unknown) {
  if (!(error instanceof RemoteError)) {
    return { problem: "unreachable", message: String(error) };
  }
  switch (error.kind) {
    case "tls":
      return { problem: "tls_untrusted", message: error.message };
    case "basic_auth":
      return { problem: "basic_auth_required", message: error.message };
    case "proxy":
      return error.status === 404
        ? { problem: "not_termix", message: error.message }
        : { problem: "proxy_login", message: error.message };
    case "signed_out":
    case "server":
      // A Termix older than 2.9 has no /sync/v2 and answers with an error.
      return { problem: "version_mismatch", message: error.message };
    default:
      return { problem: "unreachable", message: error.message };
  }
}

/**
 * @openapi
 * /sync/link/status:
 *   get:
 *     summary: This desktop's link to a server
 *     description: Desktop only. Whether the app is linked, to which server and account, how syncing is going, and which kinds of data sync.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The link status.
 */
router.get("/link/status", ...guard, async (_req: Request, res: Response) => {
  try {
    res.json(await statusBody());
  } catch (error) {
    syncLogger.error("Failed to read sync status", error, {
      operation: "sync_status",
    });
    res.status(500).json({ error: "Failed to read sync status" });
  }
});

/**
 * @openapi
 * /sync/link/probe:
 *   post:
 *     summary: Check a server address before linking
 *     description: Desktop only. Tries the server with the given proxy settings and says what is in the way, if anything. On success the proxy settings are also applied to the desktop's browser session so the sign-in page loads.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The server's name and version, or the problem found.
 */
router.post("/link/probe", ...guard, async (req: Request, res: Response) => {
  const target = readTarget(req.body ?? {});
  if (!target) return res.json({ ok: false, problem: "invalid_url" });
  try {
    const info = await remoteJson<{
      termix?: boolean;
      name?: string;
      version?: string;
      protocol?: number;
    }>(target, "/sync/v2/info", { timeoutMs: 15_000 });
    if (!info?.termix) return res.json({ ok: false, problem: "not_termix" });
    if (info.protocol !== SYNC_PROTOCOL_VERSION) {
      return res.json({
        ok: false,
        problem: "version_mismatch",
        version: info.version,
      });
    }
    await applyElectronProxyConfig({
      serverUrl: target.serverUrl,
      customHeaders: target.customHeaders ?? [],
      basicAuth: target.basicAuth ?? null,
      allowInvalidCertificate: !!target.allowInvalidCertificate,
    }).catch(() => {});
    res.json({
      ok: true,
      serverUrl: target.serverUrl,
      name: info.name ?? "Termix",
      version: info.version ?? null,
    });
  } catch (error) {
    res.json({ ok: false, ...problemFor(error) });
  }
});

/**
 * @openapi
 * /sync/link/preview:
 *   get:
 *     summary: How much this desktop has that would sync
 *     description: Desktop only. Row counts per kind of data, shown before choosing whether to merge this desktop's data into the account or replace it.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: Counts per entity type.
 */
router.get("/link/preview", ...guard, async (req: Request, res: Response) => {
  const userId = userOf(req);
  registerCoreSyncEntities();
  const counts: Record<string, number> = {};
  for (const entity of listEntities()) {
    if (entity.readOnly) continue;
    try {
      if (entity.load) {
        counts[entity.type] = (await entity.load(userId)).length;
        continue;
      }
      if (!entity.table) continue;
      counts[entity.type] = (await listStoredRows(entity, userId)).filter(
        (row) => !entity.shouldSync || entity.shouldSync(row) !== false,
      ).length;
    } catch {
      counts[entity.type] = 0;
    }
  }
  res.json({ counts });
});

/**
 * @openapi
 * /sync/link/complete:
 *   post:
 *     summary: Link this desktop to a server account
 *     description: Desktop only. Takes the session from signing in to the server, trades it for a long-lived desktop session, and starts syncing. "merge" uploads this desktop's data into the account; "replace" deletes it here first and takes the account's.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: Linked; the new status.
 *       400:
 *         description: Missing server or session.
 *       502:
 *         description: The server refused the session.
 */
router.post("/link/complete", ...guard, async (req: Request, res: Response) => {
  const userId = userOf(req);
  const body = req.body ?? {};
  const target = readTarget(body);
  const token = typeof body.token === "string" ? body.token : "";
  const mode = body.mode === "replace" ? "replace" : "merge";
  if (!target || !token) {
    return res.status(400).json({ error: "Missing server or session" });
  }

  try {
    const deviceName =
      typeof body.deviceName === "string" && body.deviceName.trim()
        ? body.deviceName.trim()
        : defaultDeviceName();
    const linked = await remoteJson<{
      token: string;
      user: { id: string; username: string };
      server?: { version?: string | null };
    }>({ ...target, sessionToken: token }, "/sync/v2/link", {
      method: "POST",
      body: { deviceName },
    });

    const previous = await getLink();
    if (previous) {
      await removeSharedCopies(previous.userId);
      await deleteRecordsForUser(previous.userId);
    }
    if (mode === "replace") {
      await wipeSyncedData(userId);
    }
    await deleteRecordsForUser(userId);

    const link = await createLink({
      userId,
      serverUrl: target.serverUrl,
      serverName: typeof body.serverName === "string" ? body.serverName : null,
      serverVersion: linked.server?.version ?? null,
      sessionToken: linked.token,
      customHeaders: target.customHeaders,
      basicAuth: target.basicAuth,
      allowInvalidCertificate: target.allowInvalidCertificate,
      remoteUserId: linked.user.id,
      remoteUsername: linked.user.username,
    });
    const engine = getSyncEngine();
    engine.reset();
    await applyElectronProxyConfig(link).catch(() => {});
    engine.request(0);
    res.json(await statusBody());
  } catch (error) {
    syncLogger.warn("Linking to a server failed", {
      operation: "sync_link_complete",
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ ...problemFor(error) });
  }
});

/**
 * @openapi
 * /sync/link/relogin:
 *   post:
 *     summary: Sign this desktop back in after its session ended
 *     description: Desktop only. Takes a new sign-in session for the same account and resumes syncing where it stopped.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: Signed in again; the new status.
 *       409:
 *         description: The sign-in was for a different account.
 */
router.post("/link/relogin", ...guard, async (req: Request, res: Response) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const link = await getLink();
  if (!link || !token) return res.status(400).json({ error: "Not linked" });
  try {
    const linked = await remoteJson<{
      token: string;
      user: { id: string; username: string };
    }>({ ...link, sessionToken: token }, "/sync/v2/link", {
      method: "POST",
      body: { deviceName: defaultDeviceName() },
    });
    if (link.remoteUserId && linked.user.id !== link.remoteUserId) {
      return res.status(409).json({ error: "different_account" });
    }
    await updateLink({
      sessionToken: linked.token,
      status: "idle",
      lastError: null,
    });
    getSyncEngine().request(0);
    res.json(await statusBody());
  } catch (error) {
    res.status(502).json({ ...problemFor(error) });
  }
});

/**
 * @openapi
 * /sync/link/unlink:
 *   post:
 *     summary: Unlink this desktop from its server
 *     description: Desktop only. Ends the desktop's session on the server when it can be reached. With keepData the synced data stays on this device as its own; otherwise it is deleted. Copies of what others shared with the account are always removed.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: Unlinked.
 */
router.post("/link/unlink", ...guard, async (req: Request, res: Response) => {
  const keepData = req.body?.keepData !== false;
  const link = await getLink();
  if (!link) return res.json(await statusBody());
  const userId = link.userId;
  try {
    await remoteJson(link, "/sync/v2/unlink", {
      method: "POST",
      body: {},
      timeoutMs: 10_000,
    }).catch(() => {});

    const engine = getSyncEngine();
    engine.reset();
    await removeSharedCopies(userId);
    if (keepData) {
      // New syncIds so this data reads as new if it is ever linked again.
      for (const entity of listEntities()) {
        if (!entity.readOnly) await regenerateSyncIds(entity, userId);
      }
    } else {
      await wipeSyncedData(userId);
    }
    await deleteRecordsForUser(userId);
    await deleteLink();
    await applyElectronProxyConfig(null).catch(() => {});
    res.json(await statusBody());
  } catch (error) {
    syncLogger.error("Unlinking failed", error, { operation: "sync_unlink" });
    res.status(500).json({ error: "Failed to unlink" });
  }
});

/**
 * @openapi
 * /sync/link/sync:
 *   post:
 *     summary: Sync now
 *     description: Desktop only. Runs a sync pass and waits for it.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The status after the pass.
 */
router.post("/link/sync", ...guard, async (_req: Request, res: Response) => {
  await getSyncEngine().syncNow();
  res.json(await statusBody());
});

/**
 * @openapi
 * /sync/link/settings:
 *   put:
 *     summary: Change what syncs and how the server is reached
 *     description: Desktop only. disabledTypes lists the kinds of data that stay on this device. Proxy headers and basic auth left blank keep their saved values.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The new status.
 *       400:
 *         description: Not linked.
 */
router.put("/link/settings", ...guard, async (req: Request, res: Response) => {
  const link = await getLink();
  if (!link) return res.status(400).json({ error: "Not linked" });
  const body = req.body ?? {};
  const patch: Parameters<typeof updateLink>[0] = {};

  if (Array.isArray(body.disabledTypes)) {
    const disabled = body.disabledTypes.filter(
      (type: unknown): type is string =>
        typeof type === "string" && type !== "accountProfile",
    );
    const changed = new Set([
      ...disabled.filter((type: string) => !link.disabledTypes.includes(type)),
      ...link.disabledTypes.filter((type) => !disabled.includes(type)),
    ]);
    patch.disabledTypes = disabled;
    // A type switched back on is pulled again in full.
    patch.knownTypes = link.knownTypes.filter((type) => !changed.has(type));
  }
  if (Array.isArray(body.customHeaders)) {
    const saved = new Map(link.customHeaders.map((h) => [h.name, h.value]));
    patch.customHeaders = (body.customHeaders as unknown[])
      .filter(
        (header): header is { name: string; value?: string } =>
          !!header && typeof (header as { name?: unknown }).name === "string",
      )
      .map((header) => ({
        name: header.name,
        value: header.value || saved.get(header.name) || "",
      }))
      .filter((header) => header.value);
    patch.customHeaders = readHeaders(patch.customHeaders);
  }
  if (body.basicAuth === null) {
    patch.basicAuth = null;
  } else if (body.basicAuth && typeof body.basicAuth === "object") {
    const next = readBasicAuth(body.basicAuth);
    if (next && !next.password && link.basicAuth) {
      next.password = link.basicAuth.password;
    }
    patch.basicAuth = next;
  }
  if (typeof body.allowInvalidCertificate === "boolean") {
    patch.allowInvalidCertificate = body.allowInvalidCertificate;
  }

  const updated = await updateLink(patch);
  await applyElectronProxyConfig(updated).catch(() => {});
  getSyncEngine().request(0);
  res.json(await statusBody());
});

/**
 * @openapi
 * /sync/link/conflicts:
 *   get:
 *     summary: Local edits that lost to a newer edit on the server
 *     description: Desktop only. The server's version was kept; each entry holds this device's version so it can be restored.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The conflicts, oldest first.
 */
router.get("/link/conflicts", ...guard, async (req: Request, res: Response) => {
  const conflicts = await listConflicts(userOf(req));
  res.json({
    conflicts: conflicts.map((conflict) => {
      let row: SyncRow = {};
      try {
        row = JSON.parse(conflict.localRow);
      } catch {
        row = {};
      }
      return {
        id: conflict.id,
        entityType: conflict.entityType,
        syncId: conflict.syncId,
        name: row.name ?? row.title ?? row.label ?? row.ip ?? conflict.syncId,
        createdAt: conflict.createdAt,
      };
    }),
  });
});

/**
 * @openapi
 * /sync/link/conflicts/{id}:
 *   post:
 *     summary: Settle a conflict
 *     description: Desktop only. keep "mine" puts this device's version back, and the next sync sends it to the server. keep "server" drops it.
 *     tags:
 *       - Sync
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Settled.
 *       404:
 *         description: No such conflict.
 */
router.post(
  "/link/conflicts/:id",
  ...guard,
  async (req: Request, res: Response) => {
    const userId = userOf(req);
    const conflict = await getConflict(userId, Number(req.params.id));
    if (!conflict) return res.status(404).json({ error: "Not found" });
    try {
      if (req.body?.keep === "mine") {
        const entity = getEntity(conflict.entityType);
        if (entity && !entity.readOnly) {
          const row = JSON.parse(conflict.localRow) as SyncRow;
          await writeWireRow(
            entity,
            userId,
            { ...row, syncId: conflict.syncId },
            createResolvers(userId),
          );
        }
      }
      await deleteConflict(userId, conflict.id);
      getSyncEngine().request(0);
      res.json({ success: true });
    } catch (error) {
      syncLogger.warn("Could not settle a sync conflict", {
        operation: "sync_conflict",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to settle conflict" });
    }
  },
);

/**
 * @openapi
 * /sync/link/errors:
 *   get:
 *     summary: Changes the server refused
 *     description: Desktop only. Each entry names the record and why the server refused it. A refused change is not sent again until it changes or is retried.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The refused changes.
 */
router.get("/link/errors", ...guard, async (req: Request, res: Response) => {
  const errors = await listRecordErrors(userOf(req));
  res.json({
    errors: errors.map((record) => ({
      entityType: record.entityType,
      syncId: record.syncId,
      reason: record.error,
    })),
  });
});

/**
 * @openapi
 * /sync/link/errors/retry:
 *   post:
 *     summary: Send refused changes again
 *     description: Desktop only. Clears every refusal and syncs.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The status after the pass.
 */
router.post(
  "/link/errors/retry",
  ...guard,
  async (req: Request, res: Response) => {
    await clearRecordErrors(userOf(req));
    await getSyncEngine().syncNow();
    res.json(await statusBody());
  },
);

/**
 * @openapi
 * /sync/link/session:
 *   get:
 *     summary: The linked server and session, for connecting to it directly
 *     description: Desktop only. Used when a host is set to connect through the server rather than from this device.
 *     tags:
 *       - Sync
 *     responses:
 *       200:
 *         description: The server address and session token, or nulls when not linked.
 */
router.get("/link/session", ...guard, async (_req: Request, res: Response) => {
  const link = await getLink();
  if (!link?.sessionToken || link.status === "signed_out") {
    return res.json({ serverUrl: null, token: null });
  }
  res.json({ serverUrl: link.serverUrl, token: link.sessionToken });
});

export default router;
