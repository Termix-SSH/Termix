/**
 * ctx.hosts: the hosts a plugin's acting user can see, and the sharing
 * operations that need core's RBAC and secret-snapshot machinery.
 *
 * list/get/checkAccess need hosts:read. share and the share-target pickers
 * need hosts:write, because granting access to a host is a write on that
 * host even though the plugin owns neither the host nor the grant.
 */

import type {
  PluginHosts,
  PluginHostSummary,
  PluginHostRecord,
  PluginHostCreateInput,
  PluginHostUpdateInput,
  PluginHostAccess,
  PluginHostShareLevel,
  PluginHostShareResult,
  PluginShareTarget,
  PluginShareableUser,
  PluginShareableRole,
  PluginHostJumpHost,
} from "@termix/plugin-sdk/backend";
import { PLUGIN_HOST_INPUT_KEYS } from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { assertCapability, capabilityRefused } from "./permissions.js";
import { hostSessionStatus } from "../hosts/host-session-status.js";
import { getActor } from "./actor.js";
import { hostStatusService } from "../hosts/status/host-status-service.js";
import { parseSshOptions } from "../hosts/ssh-options.js";
import { hostTerminalExport } from "../database/routes/host-normalizers.js";
import type { DisposableBag } from "./disposables.js";
import { pluginLogger } from "../utils/logger.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  /** Where registerPort entries go, so deactivate removes them. */
  bag?: DisposableBag;
  audit: AuditFn;
}

function toSummary(host: {
  id: number;
  userId: string;
  name: string | null;
  ip: string;
  port: number;
  username: string;
  tags: string | null;
  folder: string | null;
  authType: string;
}): PluginHostSummary {
  return {
    id: host.id,
    userId: host.userId,
    name: host.name,
    ip: host.ip,
    port: host.port,
    username: host.username,
    tags: host.tags,
    folder: host.folder,
    authType: host.authType,
  };
}

/**
 * Host fields that carry secret material. Stripped from anything ctx.hosts or
 * ctx.ssh hands a plugin, unless the plugin holds credentials:read.
 */
export const HOST_SECRET_FIELDS = [
  "password",
  "key",
  "keyPassword",
  "privateKey",
  "passphrase",
  "sudoPassword",
  "socks5Password",
] as const;

/** A copy of a host with every secret field removed, nested ones included. */
export function redactHostSecrets<T extends Record<string, unknown>>(
  host: T,
): T {
  const copy: Record<string, unknown> = { ...host };
  for (const field of HOST_SECRET_FIELDS) delete copy[field];
  const terminalConfig = copy.terminalConfig;
  if (terminalConfig && typeof terminalConfig === "object") {
    const { sudoPassword: _sudo, ...rest } = terminalConfig as Record<
      string,
      unknown
    >;
    copy.terminalConfig = rest;
  }
  if (Array.isArray(copy.socks5ProxyChain)) {
    copy.socks5ProxyChain = copy.socks5ProxyChain.map((hop) =>
      hop && typeof hop === "object"
        ? redactHostSecrets(hop as Record<string, unknown>)
        : hop,
    );
  }
  return copy as T;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asFlag(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseJumpHosts(value: unknown): PluginHostJumpHost[] {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => asNumber((entry as { hostId?: unknown })?.hostId))
    .filter((hostId): hostId is number => hostId !== null)
    .map((hostId) => ({ hostId }));
}

/**
 * A decrypted ssh_data row as PluginHostRecord. Built field by field: a
 * column reaches plugins only once the SDK types it, and no secret column is
 * ever copied.
 */
export function toRecord(
  host: Record<string, unknown>,
  pluginSettings: Record<string, unknown>,
): PluginHostRecord {
  const id = Number(host.id);
  const origin = host.connectionOrigin;
  return {
    id,
    userId: String(host.userId),
    syncId: (host.syncId as string | null) ?? null,
    name: (host.name as string | null) ?? null,
    ip: String(host.ip ?? ""),
    port: asNumber(host.port) ?? 22,
    username: String(host.username ?? ""),
    authType: String(host.authType ?? ""),
    credentialId: asNumber(host.credentialId),
    overrideCredentialUsername: asFlag(host.overrideCredentialUsername, false),
    connectionType: (host.connectionType as string | null) || "ssh",
    tags: (host.tags as string | null) ?? null,
    folder: (host.folder as string | null) ?? null,
    parentHostId: asNumber(host.parentHostId),
    pin: asFlag(host.pin, false),
    notes: (host.notes as string | null) ?? null,
    jumpHosts: parseJumpHosts(host.jumpHosts),
    enableSsh: asFlag(host.enableSsh, true),
    sshPort: asNumber(host.sshPort),
    statusCheckEnabled: asFlag(host.statusCheckEnabled, true),
    statusCheckInterval: asNumber(host.statusCheckInterval),
    connectionOrigin: origin === "local" || origin === "remote" ? origin : null,
    sshOptions: hostTerminalExport(host).sshOptions,
    pluginSettings,
    status: Number.isInteger(id) ? hostStatusService.get(id) : null,
    localOnly: asFlag(host.localOnly, false),
    createdAt: (host.createdAt as string | null) ?? null,
    updatedAt: (host.updatedAt as string | null) ?? null,
  };
}

/** Thrown when a plugin's host write names a field the SDK does not take. */
export class PluginHostInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginHostInputError";
  }
}

const INPUT_KEYS = new Set<string>(PLUGIN_HOST_INPUT_KEYS);

// Stops compiling when PluginHostCreateInput gains a key the list misses.
const inputKeysComplete: [
  Exclude<keyof PluginHostCreateInput, (typeof PLUGIN_HOST_INPUT_KEYS)[number]>,
] extends [never]
  ? true
  : never = true;
void inputKeysComplete;

/**
 * The ssh_data columns for a create or update, plus the host settings to
 * write afterwards. Refuses any key PluginHostCreateInput does not list, so a
 * field that moved into a plugin cannot be written into nothing.
 */
export function toHostWrite(input: PluginHostUpdateInput): {
  row: Record<string, unknown>;
  settings: Record<string, Record<string, unknown>>;
} {
  const unknown = Object.keys(input ?? {}).filter(
    (key) => !INPUT_KEYS.has(key),
  );
  if (unknown.length > 0) {
    throw new PluginHostInputError(
      `ctx.hosts does not take ${unknown.join(", ")}; host settings go in pluginSettings, keyed by the plugin that declares them`,
    );
  }
  const row: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) row[key] = value;
  };
  set("name", input.name);
  set("ip", input.ip);
  set("port", input.port);
  set("username", input.username);
  set("authType", input.authType);
  set("credentialId", input.credentialId);
  set("overrideCredentialUsername", input.overrideCredentialUsername);
  set("connectionType", input.connectionType);
  set(
    "tags",
    Array.isArray(input.tags)
      ? input.tags
          .map((tag) => String(tag).trim())
          .filter(Boolean)
          .join(",")
      : input.tags,
  );
  set("folder", input.folder);
  set("pin", input.pin);
  set("notes", input.notes);
  set(
    "jumpHosts",
    input.jumpHosts === undefined
      ? undefined
      : input.jumpHosts === null
        ? null
        : JSON.stringify(parseJumpHosts(input.jumpHosts)),
  );
  set("enableSsh", input.enableSsh);
  set("sshPort", input.sshPort);
  set("statusCheckEnabled", input.statusCheckEnabled);
  set("statusCheckInterval", input.statusCheckInterval);
  set(
    "forceKeyboardInteractive",
    input.forceKeyboardInteractive === undefined
      ? undefined
      : input.forceKeyboardInteractive
        ? "true"
        : "false",
  );
  set(
    "sshOptions",
    input.sshOptions === undefined
      ? undefined
      : input.sshOptions === null
        ? null
        : JSON.stringify(parseSshOptions(input.sshOptions)),
  );

  const settings: Record<string, Record<string, unknown>> = {};
  if (input.pluginSettings !== undefined && input.pluginSettings !== null) {
    if (
      typeof input.pluginSettings !== "object" ||
      Array.isArray(input.pluginSettings)
    ) {
      throw new PluginHostInputError(
        "pluginSettings must map plugin ids to their host settings",
      );
    }
    for (const [pluginId, values] of Object.entries(input.pluginSettings)) {
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        throw new PluginHostInputError(
          `pluginSettings.${pluginId} must be an object`,
        );
      }
      settings[pluginId] = values;
    }
  }
  return { row, settings };
}

function actingUser(): string {
  const actor = getActor();
  if (!actor) {
    throw new Error(
      "ctx.hosts needs an acting user: call it inside a request or ctx.asUser",
    );
  }
  return actor;
}

export function createPluginHosts({ manifest, bag, audit }: Deps): PluginHosts {
  const pluginId = manifest.id;
  const declared = manifest.capabilities;

  const requireRead = () => assertCapability(pluginId, "hosts:read", declared);
  const requireReadSync = () => {
    if (!declared.includes("hosts:read")) {
      throw capabilityRefused(pluginId, "hosts:read");
    }
  };
  const requireWrite = () =>
    assertCapability(pluginId, "hosts:write", declared);

  // With an actor, a host the actor cannot reach is out of bounds. With none,
  // it is the plugin's own background work (a poller, a guacd session).
  const actorMayReach = async (hostId: number): Promise<boolean> => {
    const actor = getActor();
    if (!actor) return true;
    const { PermissionManager } =
      await import("../utils/permission-manager.js");
    const access = await PermissionManager.getInstance().canAccessHost(
      actor,
      hostId,
      "connect",
    );
    return access.hasAccess;
  };

  // The calling plugin's own host settings, one query for the whole list.
  const toRecords = async (
    rows: Record<string, unknown>[],
  ): Promise<PluginHostRecord[]> => {
    const { loadHostPluginSettings } =
      await import("../database/routes/host-plugin-settings.js");
    const settings = await loadHostPluginSettings(
      rows.map((row) => Number(row.id)),
    );
    return rows.map((row) =>
      toRecord(row, settings.get(Number(row.id))?.[pluginId] ?? {}),
    );
  };

  const checkSettings = async (
    settings: Record<string, Record<string, unknown>>,
  ) => {
    if (Object.keys(settings).length === 0) return [];
    const { checkHostPluginSettingsInput } =
      await import("../database/routes/host-plugin-settings.js");
    const { writes, skipped, errors } = checkHostPluginSettingsInput(settings);
    if (errors.length > 0) throw new PluginHostInputError(errors.join("; "));
    if (skipped.length > 0) {
      pluginLogger.warn(
        "Host settings for plugins that are not running were skipped",
        {
          operation: "plugin_hosts_write",
          pluginId,
          skipped,
        },
      );
    }
    return writes;
  };

  const writeSettings = async (
    hostId: number,
    writes: Awaited<ReturnType<typeof checkSettings>>,
  ) => {
    if (writes.length === 0) return;
    const { writeHostPluginSettings } =
      await import("../database/routes/host-plugin-settings.js");
    for (const { manifest: owner, values } of writes) {
      await writeHostPluginSettings(owner, hostId, values);
    }
  };

  /** Host settings a plugin writes are the host's own, not its defaults. */
  const markSettingsOwn = async (
    hostId: number,
    writes: Awaited<ReturnType<typeof checkSettings>>,
  ) => {
    if (writes.length === 0) return;
    const { changeHostOverrides } =
      await import("../hosts/defaults/overrides.js");
    await changeHostOverrides([hostId], {
      own: writes.flatMap(({ manifest: owner, values }) =>
        Object.keys(values).map((key): [string, string] => [owner.id, key]),
      ),
    });
  };

  return {
    list: async () => {
      await requireRead();
      const userId = actingUser();
      const {
        createCurrentHostResolutionRepository,
        createCurrentRoleRepository,
        createCurrentRbacAccessRepository,
      } = await import("../database/repositories/factory.js");
      const repository = createCurrentHostResolutionRepository();

      const owned = await repository.findHostsByUserId(userId);
      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);
      const grants =
        await createCurrentRbacAccessRepository().listVisibleHostAccessEntries(
          userId,
          roleIds,
        );
      const sharedRows = await repository.listHostRowsForAccessList(
        userId,
        grants,
      );

      const byId = new Map<number, PluginHostSummary>();
      for (const host of owned) byId.set(host.id, toSummary(host));
      for (const host of sharedRows) {
        if (!byId.has(host.id)) byId.set(host.id, toSummary(host));
      }
      return [...byId.values()];
    },

    get: async (hostId) => {
      await requireRead();
      const userId = actingUser();
      const { PermissionManager } =
        await import("../utils/permission-manager.js");
      const access = await PermissionManager.getInstance().canAccessHost(
        userId,
        hostId,
        "connect",
      );
      if (!access.hasAccess) return null;

      const { createCurrentHostResolutionRepository } =
        await import("../database/repositories/factory.js");
      const ownerId =
        (await createCurrentHostResolutionRepository().findHostOwnerId(
          hostId,
        )) ?? userId;
      const host = await createCurrentHostResolutionRepository().findHostById(
        hostId,
        ownerId,
      );
      return host ? toSummary(host) : null;
    },

    checkAccess: async (
      hostId: number,
      level: PluginHostShareLevel,
    ): Promise<PluginHostAccess> => {
      await requireRead();
      const userId = actingUser();
      const { PermissionManager } =
        await import("../utils/permission-manager.js");
      const access = await PermissionManager.getInstance().canAccessHost(
        userId,
        hostId,
        level,
      );
      return {
        hasAccess: access.hasAccess,
        isOwner: access.isOwner,
        isShared: access.isShared,
        permissionLevel: access.permissionLevel as
          PluginHostShareLevel | undefined,
        expiresAt: access.expiresAt,
      };
    },

    create: async (host: PluginHostCreateInput): Promise<PluginHostRecord> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_create", host?.name ?? host?.ip ?? "host", {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const userId = actingUser();
      const { row, settings } = toHostWrite(host);
      const writes = await checkSettings(settings);
      const { createCurrentHostRepository } =
        await import("../database/repositories/factory.js");
      const { applyHostDefaultsToWrite, applyDefaultsAfterHostWrite } =
        await import("../hosts/defaults/index.js");
      const columns: Record<string, unknown> = { ...row, userId };
      columns.defaultOverrides = JSON.stringify(
        await applyHostDefaultsToWrite({
          ownerId: userId,
          hostId: null,
          columns,
          body: host as unknown as Record<string, unknown>,
        }),
      );
      const created =
        await createCurrentHostRepository().createEncryptedForUser(
          userId,
          columns,
        );
      await applyDefaultsAfterHostWrite(created.id);
      await writeSettings(created.id, writes);
      await markSettingsOwn(created.id, writes);
      await audit("hosts_create", `host ${created.id}`, { success: true });
      return (
        await toRecords([created as unknown as Record<string, unknown>])
      )[0];
    },

    update: async (
      hostId: number,
      patch: PluginHostUpdateInput,
    ): Promise<PluginHostRecord | null> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_update", `host ${hostId}`, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const userId = actingUser();
      const { row, settings } = toHostWrite(patch);
      const writes = await checkSettings(settings);
      const { createCurrentHostRepository } =
        await import("../database/repositories/factory.js");
      const { applyHostDefaultsToWrite, applyDefaultsAfterHostWrite } =
        await import("../hosts/defaults/index.js");
      const { createCurrentHostDefaultsRepository } =
        await import("../database/repositories/factory.js");
      const stored = (
        await createCurrentHostDefaultsRepository().listHosts({
          hostIds: [hostId],
        })
      )[0];
      const columns: Record<string, unknown> = { ...row };
      if (stored && stored.userId === userId) {
        columns.defaultOverrides = JSON.stringify(
          await applyHostDefaultsToWrite({
            ownerId: userId,
            hostId,
            columns,
            body: patch as unknown as Record<string, unknown>,
            stored,
          }),
        );
      }
      const updated =
        await createCurrentHostRepository().updateEncryptedForUser(
          userId,
          hostId,
          columns,
        );
      if (updated) {
        await writeSettings(hostId, writes);
        await markSettingsOwn(hostId, writes);
        await applyDefaultsAfterHostWrite(hostId, {
          moved:
            !!stored &&
            ((columns.folder !== undefined &&
              (columns.folder ?? null) !== (stored.folder ?? null)) ||
              (columns.parentHostId !== undefined &&
                (columns.parentHostId ?? null) !==
                  (stored.parentHostId ?? null))),
          ownerId: userId,
        });
      }
      await audit("hosts_update", `host ${hostId}`, {
        success: updated !== null,
      });
      return updated
        ? (await toRecords([updated as unknown as Record<string, unknown>]))[0]
        : null;
    },

    delete: async (hostId: number): Promise<boolean> => {
      try {
        await requireWrite();
        const userId = actingUser();
        const { PermissionManager } =
          await import("../utils/permission-manager.js");
        if (
          !(await PermissionManager.getInstance().hasPermission(
            userId,
            "hosts.delete",
          ))
        ) {
          throw new Error("The acting user may not delete hosts");
        }
        const { deleteOwnedHost } = await import("../hosts/delete-host.js");
        const deleted = await deleteOwnedHost(userId, hostId);
        await audit("hosts_delete", `host ${hostId}`, {
          success: deleted !== null,
        });
        return deleted !== null;
      } catch (error) {
        await audit("hosts_delete", `host ${hostId}`, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    listOwned: async (): Promise<PluginHostRecord[]> => {
      await requireWrite();
      const userId = actingUser();
      const { createCurrentHostRepository } =
        await import("../database/repositories/factory.js");
      const rows =
        await createCurrentHostRepository().listDecryptedByUserId(userId);
      await audit("hosts_list_owned", `${rows.length} host(s)`, {
        success: true,
      });
      return toRecords(rows as unknown as Record<string, unknown>[]);
    },

    share: async (
      hostId: number,
      targets: PluginShareTarget[],
      permissionLevel: PluginHostShareLevel,
      durationHours?: number,
    ): Promise<PluginHostShareResult> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_share", `host ${hostId}`, {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      const userId = actingUser();
      const { PermissionManager } =
        await import("../utils/permission-manager.js");
      const access = await PermissionManager.getInstance().canAccessHost(
        userId,
        hostId,
        "manage",
      );
      if (!access.hasAccess) {
        const result: PluginHostShareResult = {
          hostId,
          shared: false,
          reason: "forbidden",
        };
        await audit("hosts_share", `host ${hostId}`, {
          success: false,
          errorMessage: "forbidden",
        });
        return result;
      }

      const {
        createCurrentHostResolutionRepository,
        createCurrentRbacAccessRepository,
      } = await import("../database/repositories/factory.js");
      const ownerId =
        (await createCurrentHostResolutionRepository().findHostOwnerId(
          hostId,
        )) ?? userId;

      if (targets.some((t) => t.type === "user" && t.id === ownerId)) {
        await audit("hosts_share", `host ${hostId}`, {
          success: false,
          errorMessage: "owner",
        });
        return { hostId, shared: false, reason: "owner" };
      }

      const expiresAt =
        durationHours && durationHours > 0
          ? new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString()
          : null;

      const rbacAccessRepository = createCurrentRbacAccessRepository();
      const { SharedHostSecretsManager } =
        await import("../utils/shared-host-secrets-manager.js");
      const secretsManager = SharedHostSecretsManager.getInstance();

      for (const target of targets) {
        const grant = await rbacAccessRepository.upsertHostAccess({
          hostId,
          grantedBy: userId,
          permissionLevel,
          expiresAt,
          ...(target.type === "user"
            ? { targetType: "user" as const, targetUserId: target.id as string }
            : {
                targetType: "role" as const,
                targetRoleId: target.id as number,
              }),
        });

        try {
          if (target.type === "user") {
            await secretsManager.snapshotForUser(
              grant.id,
              hostId,
              target.id as string,
              ownerId,
            );
          } else {
            await secretsManager.snapshotForRole(
              grant.id,
              hostId,
              target.id as number,
              ownerId,
            );
          }
        } catch {
          // A snapshot failure never blocks the grant: the recipient can
          // still be prompted, or the owner can retry sharing later.
        }
      }

      await audit("hosts_share", `host ${hostId}`, { success: true });
      return { hostId, shared: true };
    },

    listUsers: async (): Promise<PluginShareableUser[]> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_list_users", "share target picker", {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const { createCurrentUserRepository } =
        await import("../database/repositories/factory.js");
      const users = await createCurrentUserRepository().listAll();
      await audit("hosts_list_users", "share target picker", {
        success: true,
      });
      return users.map((u) => ({ id: u.id, username: u.username }));
    },

    listRoles: async (): Promise<PluginShareableRole[]> => {
      try {
        await requireWrite();
      } catch (error) {
        await audit("hosts_list_roles", "share target picker", {
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const { createCurrentRoleRepository } =
        await import("../database/repositories/factory.js");
      const roles = await createCurrentRoleRepository().listRoles();
      await audit("hosts_list_roles", "share target picker", {
        success: true,
      });
      return roles
        .filter((r) => !r.isSystem)
        .map((r) => ({ id: r.id, name: r.name, displayName: r.displayName }));
    },

    // Synchronous so a transport can call it from an ssh2 "ready" handler, so
    // only the declaration is checked up front, like ctx.http.router. The
    // session only counts once the actor's access to the host is confirmed.
    trackSession: (hostId: number) => {
      if (!declared.includes("hosts:read")) {
        throw capabilityRefused(pluginId, "hosts:read");
      }
      let release: (() => void) | null = null;
      let stopped = false;
      void actorMayReach(hostId)
        .then((allowed) => {
          if (allowed && !stopped) release = hostSessionStatus.register(hostId);
        })
        .catch(() => {});
      return () => {
        stopped = true;
        release?.();
        release = null;
      };
    },

    recordActivity: async (hostId, type, hostName) => {
      await requireRead();
      const userId = actingUser();
      if (!(await actorMayReach(hostId))) return;
      const { recordRecentActivity } =
        await import("../services/recent-activity.js");
      await recordRecentActivity(userId, { type, hostId, hostName });
    },

    // Not audited: pollers call these on every sample.
    status: {
      get: async (hostId) => {
        await requireRead();
        if (!(await actorMayReach(hostId))) return null;
        return hostStatusService.get(hostId);
      },
      check: async (hostId) => {
        await requireRead();
        if (!(await actorMayReach(hostId))) return null;
        return hostStatusService.check(hostId);
      },
      // Synchronous for the same reason as trackSession.
      reportLogin: (hostId, outcome) => {
        requireReadSync();
        void actorMayReach(hostId)
          .then((allowed) => {
            if (allowed) hostStatusService.reportLogin(hostId, outcome);
          })
          .catch(() => {});
      },
      registerPort: (connectionType, resolve) => {
        requireReadSync();
        const unregister = hostStatusService.registerPort(
          connectionType,
          resolve,
        );
        const drop = bag?.add(unregister, `status port for ${connectionType}`);
        return () => {
          drop?.();
          unregister();
        };
      },
    },
  };
}
