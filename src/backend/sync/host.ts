/**
 * What the sync provider plugin gets from core through ctx.sync.host: the
 * replica store, the change feed, the linked server registry, sessions and
 * a few helpers. Core stays neutral; the plugin decides what to do with it.
 */

import fs from "fs";
import os from "os";
import path from "path";
import * as tar from "tar";
import { and, eq, isNotNull } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import type { PluginSyncHost, SyncRow } from "@termix-ssh/plugin-sdk/backend";
import { resolvePluginDesktopMode } from "@termix-ssh/plugin-sdk/manifest";
import { AuthManager } from "../utils/auth-manager.js";
import { getLocalVersion } from "../utils/app-version.js";
import { syncLogger } from "../utils/logger.js";
import { sendCoreAlert } from "../notify/core-notify.js";
import { getPluginRuntime } from "../plugins/index.js";
import {
  getEntity,
  listEntities,
  onEntitiesChanged,
  type RegisteredSyncEntity,
} from "../plugins/sync-registry.js";
import {
  createCurrentHostRepository,
  createCurrentHostResolutionRepository,
  createCurrentPluginPermissionGrantRepository,
  createCurrentPluginRepository,
  createCurrentRepositoryContext,
  createCurrentSessionRepository,
  createCurrentSettingsRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import { resolveBrandingSettings } from "../database/routes/branding-settings.js";
import { hosts, sshCredentials } from "../database/db/schema.js";
import {
  createResolvers,
  deleteStoredRow,
  listStoredRows,
  loadWireRow,
  loadWireRows,
  regenerateSyncIds,
  writeWireRow,
  type Resolvers,
} from "./store.js";
import {
  clearRecordErrors,
  deleteConflict,
  deleteRecordsForUser,
  getConflict,
  listChanges,
  listConflicts,
  listRecordErrors,
  listRecords,
  putRecord,
  recordKey,
  saveConflict,
  setRecordError,
} from "./records.js";
import { orderSelfReferences } from "./wire.js";
import { onLocalWrite } from "./server/write-listeners.js";
import {
  createLink,
  deleteLink,
  getLink,
  listLinks,
  updateLink,
} from "./client/link-store.js";
import {
  createAccount,
  getActiveUserId,
  listAccounts,
  removeAccount,
  setActiveUserId,
} from "./accounts.js";
import {
  normalizeServerUrl,
  RemoteError,
  remoteFetch,
  remoteJson,
} from "./client/http.js";
import { applyElectronProxyConfig } from "./client/electron-proxy.js";
import { lastRemotePlugins, mirrorPlugins } from "./client/plugins.js";
import { defaultDeviceName } from "./client/device.js";

function entityOf(type: string): RegisteredSyncEntity {
  const entity = getEntity(type);
  if (!entity) throw new Error(`Unknown sync entity "${type}"`);
  return entity;
}

function info(entity: RegisteredSyncEntity) {
  return {
    type: entity.type,
    owner: entity.owner,
    order: entity.order,
    readOnly: !!entity.readOnly,
    covers: entity.covers,
  };
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

/** Removes read-only copies of what other users shared with the account. */
async function removeSharedCopies(userId: string): Promise<void> {
  const db = createCurrentRepositoryContext().drizzle;
  const sharedHosts = await db
    .select({ id: hosts.id })
    .from(hosts)
    .where(and(eq(hosts.userId, userId), isNotNull(hosts.sharedSource)));
  const { deleteOwnedHost } = await import("../hosts/delete-host.js");
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
    await import("../hosts/delete-credential.js");
  for (const credential of sharedCredentials) {
    await deleteOwnedCredential(userId, credential.id);
  }
}

async function ensureCoreEntities(): Promise<void> {
  const { registerCoreSyncEntities } = await import("./entities.js");
  registerCoreSyncEntities();
}

async function counts(userId: string): Promise<Record<string, number>> {
  await ensureCoreEntities();
  const result: Record<string, number> = {};
  for (const entity of listEntities()) {
    if (entity.readOnly) continue;
    try {
      if (entity.load) {
        result[entity.type] = (await entity.load(userId)).length;
        continue;
      }
      if (!entity.table) continue;
      result[entity.type] = (await listStoredRows(entity, userId)).filter(
        (row) => !entity.shouldSync || entity.shouldSync(row) !== false,
      ).length;
    } catch {
      result[entity.type] = 0;
    }
  }
  return result;
}

async function listPluginsForDesktop() {
  const records = new Map(
    (await createCurrentPluginRepository().listAll()).map((record) => [
      record.id,
      record,
    ]),
  );
  const grants = createCurrentPluginPermissionGrantRepository();
  const plugins = [];
  for (const plugin of getPluginRuntime().loader.list()) {
    plugins.push({
      id: plugin.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      source: plugin.source,
      // A bundled plugin updated from a signed .tmxplug can be mirrored.
      artifact: !!plugin.artifact,
      enabled: records.get(plugin.id)?.state === "enabled",
      active: plugin.state === "active",
      desktop: resolvePluginDesktopMode(plugin.manifest),
      syncEntities: plugin.manifest.contributes?.syncEntities ?? [],
      granted: (await grants.listByPlugin(plugin.id)).map(
        (grant) => grant.capability,
      ),
    });
  }
  const { customRegistryKeys } = await import("../plugins/registries.js");
  return { plugins, registryKeys: await customRegistryKeys() };
}

async function sendPackage(
  pluginId: string,
  target: unknown,
): Promise<boolean> {
  const res = target as Response;
  const plugin = getPluginRuntime()
    .loader.list()
    .find((candidate) => candidate.id === pluginId);
  if (!plugin || (plugin.source !== "user" && !plugin.artifact)) return false;
  const artifact = plugin.artifact ?? "";
  res.setHeader("Content-Type", "application/gzip");
  if (fs.existsSync(artifact)) {
    const sig = `${artifact}.sig`;
    if (fs.existsSync(sig)) {
      res.setHeader(
        "X-Termix-Signature",
        Buffer.from(await fs.promises.readFile(sig, "utf8")).toString("base64"),
      );
    }
    fs.createReadStream(artifact).pipe(res);
    return true;
  }
  const temp = path.join(
    os.tmpdir(),
    `termix-plugin-${pluginId}-${Date.now()}.tmxplug`,
  );
  await tar.c({ gzip: true, cwd: plugin.dir, file: temp }, ["."]);
  const stream = fs.createReadStream(temp);
  stream.on("close", () => void fs.promises.rm(temp, { force: true }));
  stream.pipe(res);
  return true;
}

export function createSyncHost(): PluginSyncHost {
  const authManager = AuthManager.getInstance();

  return {
    embedded: process.env.ELECTRON_EMBEDDED === "true",
    info: {
      appName: async () => {
        try {
          return (
            await resolveBrandingSettings(createCurrentSettingsRepository())
          ).appName;
        } catch {
          return "Termix";
        }
      },
      version: () => getLocalVersion(),
    },

    entities: {
      list: () => listEntities().map(info),
      get: (type) => {
        const entity = getEntity(type);
        return entity ? info(entity) : undefined;
      },
      ensureCore: () => ensureCoreEntities(),
      onChanged: (listener) => onEntitiesChanged(listener),
      onLocalWrite: (listener) => onLocalWrite(listener),
    },

    replica: {
      resolvers: (userId, onMissing) => createResolvers(userId, onMissing),
      loadRows: async (type, userId, resolvers) => {
        const result = await loadWireRows(
          entityOf(type),
          userId,
          resolvers as Resolvers,
        );
        return { rows: result.rows, failed: result.failed };
      },
      loadRow: (type, userId, syncId, resolvers) =>
        loadWireRow(entityOf(type), userId, syncId, resolvers as Resolvers),
      writeRow: async (type, userId, wire, resolvers) => {
        await writeWireRow(
          entityOf(type),
          userId,
          wire,
          resolvers as Resolvers,
        );
      },
      deleteRow: async (type, userId, syncId) => {
        await deleteStoredRow(entityOf(type), userId, syncId);
      },
      orderSelfReferences: (type, rows) =>
        orderSelfReferences(entityOf(type), rows as SyncRow[]),
      counts: (userId) => counts(userId),
      wipe: (userId) => wipeSyncedData(userId),
      regenerateSyncIds: async (userId) => {
        for (const entity of listEntities()) {
          if (!entity.readOnly) await regenerateSyncIds(entity, userId);
        }
      },
      removeSharedCopies: (userId) => removeSharedCopies(userId),
      records: {
        list: (userId) => listRecords(userId) as never,
        put: (userId, type, syncId, values) =>
          putRecord(userId, type, syncId, values),
        setError: (userId, type, syncId, reason, hash) =>
          setRecordError(userId, type, syncId, reason, hash),
        clearErrors: (userId) => clearRecordErrors(userId),
        listErrors: (userId) => listRecordErrors(userId) as never,
        deleteForUser: (userId) => deleteRecordsForUser(userId),
        key: (type, syncId) => recordKey(type, syncId),
      },
      conflicts: {
        save: (userId, type, syncId, row, revision) =>
          saveConflict(userId, type, syncId, row, revision),
        list: (userId) => listConflicts(userId) as never,
        get: (userId, id) => getConflict(userId, id) as never,
        delete: (userId, id) => deleteConflict(userId, id),
      },
    },

    feed: {
      withUserLock: async (userId, run) => {
        const { withUserLock } = await import("./server/feed.js");
        return withUserLock(userId, run);
      },
      changes: async (userId, cursor, limit, types) => {
        const { withUserLock, reconcileUser } =
          await import("./server/feed.js");
        const page = await withUserLock(userId, async () => {
          const { wire } = await reconcileUser(userId);
          const records = await listChanges(userId, cursor, limit + 1, types);
          return { wire, records };
        });
        const hasMore = page.records.length > limit;
        const records = [];
        for (const record of page.records.slice(0, limit)) {
          if (!getEntity(record.entityType)) continue;
          const row = record.deleted
            ? null
            : (page.wire.get(recordKey(record.entityType, record.syncId)) ??
              null);
          // A live record with no row failed to serialize; it comes again once
          // it changes, rather than arriving as a delete.
          if (!record.deleted && !row) continue;
          records.push({
            seq: record.seq,
            entityType: record.entityType,
            syncId: record.syncId,
            revision: record.revision,
            deleted: !!record.deleted,
            row,
          });
        }
        const slice = page.records.slice(0, limit);
        return {
          records,
          hasMore,
          nextCursor: slice.length ? slice[slice.length - 1].seq : cursor,
          entityTypes: listEntities().map((entity) => ({
            type: entity.type,
            owner: entity.owner,
            order: entity.order,
            readOnly: !!entity.readOnly,
          })),
        } as never;
      },
      parsePushOps: async (body) => {
        const { parsePushOps } = await import("./server/push.js");
        return parsePushOps(body) as never;
      },
      applyPush: async (userId, ops) => {
        const { withUserLock } = await import("./server/feed.js");
        const { applyPush } = await import("./server/push.js");
        return withUserLock(userId, () =>
          applyPush(userId, ops as never),
        ) as never;
      },
      listen: async (userId, res) => {
        const { addListener } = await import("./server/feed.js");
        return addListener(userId, res as Response);
      },
    },

    links: {
      list: () => listLinks() as never,
      get: (userId) => getLink(userId) as never,
      create: (link) => createLink(link) as never,
      update: (patch, userId) => updateLink(patch, userId) as never,
      remove: (userId) => deleteLink(userId),
    },

    accounts: {
      list: () => listAccounts(),
      create: () => createAccount(),
      setActive: (userId) => setActiveUserId(userId),
      activeId: () => getActiveUserId(),
      remove: (userId) => removeAccount(userId),
    },

    http: {
      json: (target, pathname, request) =>
        remoteJson(target, pathname, request),
      fetch: ((target, pathname, request) =>
        remoteFetch(target, pathname, request)) as never,
      normalizeServerUrl,
      isRemoteError: ((error: unknown) =>
        error instanceof RemoteError) as never,
    },

    sessions: {
      issueDesktop: (userId, options) =>
        authManager.generateJWTToken(userId, {
          expiresIn: `${options.days}d`,
          deviceType: "desktop",
          deviceInfo: options.deviceInfo,
        }),
      revoke: async (sessionId) => {
        await authManager.revokeSession(sessionId);
      },
      find: async (sessionId) => {
        const session =
          await createCurrentSessionRepository().findById(sessionId);
        return session
          ? { expiresAt: session.expiresAt, deviceInfo: session.deviceInfo }
          : null;
      },
      findUser: async (userId) => {
        const user = await createCurrentUserRepository().findById(userId);
        return user ? { id: user.id, username: user.username } : null;
      },
      verify: async (token) => {
        const payload = await authManager.verifyJWTToken(token);
        return payload
          ? { userId: payload.userId, sessionId: payload.sessionId }
          : null;
      },
      setCookie: (req, res, value, options) => {
        (res as Response).cookie(
          options?.name ?? "jwt",
          value,
          authManager.getSecureCookieOptions(
            req as Request,
            (options?.days ?? 30) * 24 * 60 * 60 * 1000,
          ),
        );
      },
      clearCookie: (req, res, name) => {
        (res as Response).clearCookie(
          name ?? "jwt",
          authManager.getClearCookieOptions(req as Request),
        );
      },
      middleware: () => authManager.createAuthMiddleware(),
      desktopOnly: () => (_req: Request, res: Response, next: NextFunction) => {
        if (process.env.ELECTRON_EMBEDDED !== "true") {
          res.status(404).json({ error: "Not found" });
          return;
        }
        next();
      },
    },

    hosts: {
      findForSync: async (userId, syncId) => {
        const hostId =
          await createCurrentHostResolutionRepository().findHostIdBySyncId(
            syncId,
          );
        if (hostId === null) return null;
        const { PermissionManager } =
          await import("../utils/permission-manager.js");
        const access = await PermissionManager.getInstance().canAccessHost(
          userId,
          hostId,
          "connect",
        );
        if (!access.hasAccess) return null;
        const row = await createCurrentHostRepository().findById(hostId);
        return { id: hostId, name: row?.name ?? row?.ip ?? null };
      },
      statusBySyncId: async (userId) => {
        const { hostStatus } =
          await import("../plugins/host-status-provider.js");
        const { PermissionManager } =
          await import("../utils/permission-manager.js");
        const statuses = await hostStatus.statusesFor(userId, null);
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
        return result;
      },
    },

    plugins: {
      listForDesktop: listPluginsForDesktop as never,
      sendPackage,
      mirror: (link) => mirrorPlugins(link as never),
      lastRemote: () => lastRemotePlugins() as never,
      localNames: () => {
        const names = new Map<string, string>();
        for (const plugin of getPluginRuntime().loader.list()) {
          names.set(plugin.id, plugin.manifest.name);
        }
        return names;
      },
    },

    desktop: {
      applyProxy: (link) => applyElectronProxyConfig(link as never),
      deviceName: defaultDeviceName,
    },

    alerts: {
      send: (alert) =>
        sendCoreAlert({
          title: alert.title,
          body: alert.body,
          severity: alert.severity,
          category: alert.category,
          dedupeKey: alert.dedupeKey,
          audience: "admins",
          link: alert.link,
        } as never),
    },
  };
}
