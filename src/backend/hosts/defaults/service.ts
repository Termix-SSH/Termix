/**
 * Reading, checking and saving one level of host defaults, and resolving a
 * host's defaults for the editor. The routes are a thin layer over this.
 */

import {
  coerceSettingValue,
  validateSettingValue,
} from "@termix/plugin-sdk/settings";
import { createCurrentHostDefaultsRepository } from "../../database/repositories/factory.js";
import type { HostDefaultsScope } from "../../database/repositories/host-defaults-repository.js";
import { validateSettingsSave } from "../../plugins/settings.js";
import {
  CORE_NAMESPACE,
  SECRET_AUTH_TYPES,
  normalizeAuthDefault,
  splitDefaultKey,
  type ResolvedHostDefault,
} from "../../../types/host-defaults.js";
import type { DefaultKeyInfo, DefaultsCatalog } from "./catalog.js";
import {
  decodeDefaultValue,
  encodeDefaultValue,
  loadDefaultsIndex,
  levelsForHost,
} from "./levels.js";
import {
  currentCatalog,
  loadPlacement,
  resolveForHost,
} from "./materialize.js";
import {
  effectiveFolderPath,
  folderChainPaths,
  type HostLevels,
} from "./resolve.js";

export interface LevelChangeInput {
  set?: Record<string, unknown>;
  unset?: string[];
}

export interface ValidatedLevelChange {
  set: Map<string, unknown>;
  unset: Set<string>;
  errors: Record<string, string>;
}

/** What a level holds, by "namespace.key". */
export async function readLevel(
  scope: HostDefaultsScope,
): Promise<Record<string, unknown>> {
  const rows = await createCurrentHostDefaultsRepository().listScope(scope);
  const values: Record<string, unknown> = {};
  for (const row of rows) {
    values[`${row.namespace}.${row.key}`] = decodeDefaultValue(row.value);
  }
  return values;
}

/** The levels above one, which is what a key reads when this level leaves it unset. */
export async function levelsAbove(
  scope: HostDefaultsScope,
  folderOwner?: { userId: string; name: string },
): Promise<HostLevels> {
  const empty: HostLevels = { admin: new Map(), user: new Map(), folders: [] };
  if (scope.level === "admin") return empty;
  const ownerId =
    scope.level === "user" ? String(scope.userId) : folderOwner?.userId;
  if (!ownerId) return empty;
  const index = await loadDefaultsIndex([ownerId]);
  if (scope.level === "user") {
    return { ...empty, admin: index.admin };
  }
  const parents = folderChainPaths(folderOwner?.name).slice(0, -1);
  const own = index.folders.get(ownerId);
  return {
    admin: index.admin,
    user: index.users.get(ownerId) ?? new Map(),
    folders: parents
      .map((path) => own?.get(path))
      .filter((folder): folder is NonNullable<typeof folder> => !!folder),
  };
}

export function resolveAll(
  catalog: DefaultsCatalog,
  levels: HostLevels,
  hostId: number | null = null,
): Record<string, ResolvedHostDefault> {
  const result: Record<string, ResolvedHostDefault> = {};
  for (const info of catalog.values()) {
    const resolved = resolveForHost(info, levels, hostId);
    if (resolved) result[info.fullKey] = resolved;
  }
  return result;
}

export interface CheckContext {
  actorId: string;
  /** Whose rows a user or folder level may point at. */
  ownerId: string | null;
  canUseCredential: (credentialId: number, userId: string) => Promise<boolean>;
  canUseHost: (hostId: number, userId: string) => Promise<boolean>;
}

async function checkCoreValue(
  info: DefaultKeyInfo,
  value: unknown,
  scope: HostDefaultsScope,
  context: CheckContext,
): Promise<string | null> {
  if (info.key === "auth") {
    const auth = normalizeAuthDefault(value);
    if (!auth) return "An auth default needs an auth type";
    if (SECRET_AUTH_TYPES.includes(auth.authType)) {
      return "Password and key logins belong to one host and cannot be a default";
    }
    if (auth.authType === "credential") {
      if (scope.level === "admin") {
        return "A credential belongs to one user, so it cannot be a server default";
      }
      if (
        auth.credentialId === null ||
        !context.ownerId ||
        !(await context.canUseCredential(auth.credentialId, context.ownerId))
      ) {
        return "That credential is not available";
      }
    }
  }
  if (info.key === "jumpHosts" && Array.isArray(value) && context.ownerId) {
    for (const entry of value as Array<{ hostId?: unknown }>) {
      const hostId = Number(entry?.hostId);
      if (
        !Number.isInteger(hostId) ||
        !(await context.canUseHost(hostId, context.ownerId))
      ) {
        return "A jump host in the chain is not available";
      }
    }
  }
  return null;
}

/** Checks a level change against the catalog, each key's levels and its field. */
export async function validateLevelChange(
  scope: HostDefaultsScope,
  input: LevelChangeInput,
  context: CheckContext,
  catalog: DefaultsCatalog = currentCatalog().catalog,
): Promise<ValidatedLevelChange> {
  const set = new Map<string, unknown>();
  const unset = new Set<string>();
  const errors: Record<string, string> = {};

  for (const fullKey of input.unset ?? []) {
    if (typeof fullKey === "string") unset.add(fullKey);
  }

  const pluginValues = new Map<string, Record<string, unknown>>();
  for (const [fullKey, raw] of Object.entries(input.set ?? {})) {
    const info = catalog.get(fullKey);
    if (!info) {
      errors[fullKey] = "Not a host setting that can have a default";
      continue;
    }
    if (!info.levels.includes(scope.level)) {
      errors[fullKey] = `Cannot be set as a ${scope.level} default`;
      continue;
    }
    if (info.namespace === CORE_NAMESPACE) {
      const error = await checkCoreValue(info, raw, scope, context);
      if (error) {
        errors[fullKey] = error;
        continue;
      }
      set.set(fullKey, info.normalize(raw));
      continue;
    }
    const field = info.field!;
    const coerced = coerceSettingValue(field, raw);
    const error = validateSettingValue(field, coerced);
    if (error) {
      errors[fullKey] = error;
      continue;
    }
    set.set(fullKey, info.normalize(coerced));
    const own = pluginValues.get(info.namespace) ?? {};
    own[info.key] = coerced;
    pluginValues.set(info.namespace, own);
  }

  for (const [pluginId, values] of pluginValues) {
    const rejected = await validateSettingsSave(
      pluginId,
      "host",
      null,
      values,
      { level: scope.level },
    );
    for (const [key, message] of Object.entries(rejected)) {
      errors[key === "_" ? pluginId : `${pluginId}.${key}`] = message;
    }
  }

  for (const key of set.keys()) unset.delete(key);
  return { set, unset, errors };
}

export async function saveLevel(
  scope: HostDefaultsScope,
  change: ValidatedLevelChange,
  actorId: string,
): Promise<void> {
  await createCurrentHostDefaultsRepository().apply(
    scope,
    [...change.set].map(([fullKey, value]) => {
      const [namespace, key] = splitDefaultKey(fullKey);
      return { namespace, key, value: encodeDefaultValue(value) };
    }),
    [...change.unset].map((fullKey) => {
      const [namespace, key] = splitDefaultKey(fullKey);
      return { namespace, key };
    }),
    actorId,
  );
}

/**
 * What a host (or a new one in a folder or under a parent) resolves every
 * key to, with where each value comes from.
 */
export async function resolveForEditor(input: {
  ownerId: string;
  hostId?: number | null;
  folder?: string | null;
  parentHostId?: number | null;
}): Promise<Record<string, ResolvedHostDefault>> {
  const { catalog } = currentCatalog();
  const placement = await loadPlacement([input.ownerId]);
  const self = input.hostId ?? -1;
  const stored = placement.get(self);
  placement.set(self, {
    folder:
      input.folder !== undefined ? input.folder : (stored?.folder ?? null),
    parentHostId:
      input.parentHostId !== undefined
        ? input.parentHostId
        : (stored?.parentHostId ?? null),
  });
  const index = await loadDefaultsIndex([input.ownerId]);
  const levels = levelsForHost(
    index,
    input.ownerId,
    effectiveFolderPath(self, placement),
  );
  return resolveAll(catalog, levels, input.hostId ?? null);
}

/**
 * A folder's credential is its auth default: hosts in the folder that follow
 * their defaults sign in with it. Null clears it.
 */
export async function setFolderCredentialDefault(
  userId: string,
  folderId: number,
  credentialId: number | null,
): Promise<void> {
  await createCurrentHostDefaultsRepository().apply(
    { level: "folder", folderId, userId },
    credentialId === null
      ? []
      : [
          {
            namespace: CORE_NAMESPACE,
            key: "auth",
            value: encodeDefaultValue(
              normalizeAuthDefault({ authType: "credential", credentialId }),
            ),
          },
        ],
    credentialId === null ? [{ namespace: CORE_NAMESPACE, key: "auth" }] : [],
    userId,
  );
}
