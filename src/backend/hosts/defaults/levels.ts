/**
 * Loads host default levels from the database into the maps the resolver
 * reads. One pass covers any number of users.
 */

import {
  createCurrentHostDefaultsRepository,
  createCurrentSettingsRepository,
} from "../../database/repositories/factory.js";
import type { HostDefaultsRecord } from "../../database/repositories/host-defaults-repository.js";
import { joinDefaultKey } from "../../../types/host-defaults.js";
import {
  folderChainPaths,
  type FolderLevel,
  type HostLevels,
  type LevelMap,
} from "./resolve.js";

/**
 * On a desktop linked to a server, the server's admin defaults arrive over
 * sync and are kept here. They stand in for the desktop's own admin level so
 * both sides resolve a host the same way.
 */
export const REMOTE_ADMIN_DEFAULTS_KEY = "host_defaults_remote_admin";

export interface DefaultsIndex {
  admin: LevelMap;
  users: Map<string, LevelMap>;
  /** userId -> folder path -> the folder's level. */
  folders: Map<string, Map<string, FolderLevel>>;
}

export function decodeDefaultValue(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function encodeDefaultValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

async function remoteAdminLevel(): Promise<LevelMap | null> {
  try {
    const raw = await createCurrentSettingsRepository().get(
      REMOTE_ADMIN_DEFAULTS_KEY,
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return new Map(Object.entries(parsed as Record<string, unknown>));
  } catch {
    return null;
  }
}

export function buildIndex(
  rows: HostDefaultsRecord[],
  folders: Array<{ id: number; userId: string; name: string }>,
): DefaultsIndex {
  const index: DefaultsIndex = {
    admin: new Map(),
    users: new Map(),
    folders: new Map(),
  };
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of folders) {
    let own = index.folders.get(folder.userId);
    if (!own) {
      own = new Map();
      index.folders.set(folder.userId, own);
    }
    own.set(folder.name, {
      folderId: folder.id,
      name: folder.name,
      values: new Map(),
    });
  }

  for (const row of rows) {
    const fullKey = joinDefaultKey(row.namespace, row.key);
    const value = decodeDefaultValue(row.value);
    if (row.level === "admin") {
      index.admin.set(fullKey, value);
    } else if (row.level === "user" && row.userId) {
      let own = index.users.get(row.userId);
      if (!own) {
        own = new Map();
        index.users.set(row.userId, own);
      }
      own.set(fullKey, value);
    } else if (row.level === "folder" && row.folderId !== null) {
      const folder = folderById.get(row.folderId);
      if (!folder) continue;
      index.folders
        .get(folder.userId)
        ?.get(folder.name)
        ?.values.set(fullKey, value);
    }
  }
  return index;
}

export async function loadDefaultsIndex(
  userIds: string[],
): Promise<DefaultsIndex> {
  const repository = createCurrentHostDefaultsRepository();
  const [rows, folders, remoteAdmin] = await Promise.all([
    repository.listForUsers(userIds),
    repository.listFolders(userIds),
    remoteAdminLevel(),
  ]);
  const index = buildIndex(rows, folders);
  if (remoteAdmin) index.admin = remoteAdmin;
  return index;
}

export function levelsForHost(
  index: DefaultsIndex,
  userId: string,
  folderPath: string | null,
): HostLevels {
  const own = index.folders.get(userId);
  const folders: FolderLevel[] = [];
  for (const path of folderChainPaths(folderPath)) {
    const folder = own?.get(path);
    if (folder) folders.push(folder);
  }
  return {
    admin: index.admin,
    user: index.users.get(userId) ?? new Map(),
    folders,
  };
}
