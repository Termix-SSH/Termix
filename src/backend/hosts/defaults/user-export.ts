/**
 * A user's own and folder host defaults in the per-user export database.
 * Folders travel by path, since their ids mean nothing on another server.
 * An import is checked like any other save, so a credential or jump host
 * the importing user cannot use is skipped, and a key the level already
 * holds is left as it is.
 */

import type Database from "better-sqlite3";
import { createCurrentHostDefaultsRepository } from "../../database/repositories/factory.js";
import type { HostDefaultsScope } from "../../database/repositories/host-defaults-repository.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { findUsableCredential } from "../usable-credential.js";
import { decodeDefaultValue } from "./levels.js";
import { readLevel, saveLevel, validateLevelChange } from "./service.js";

export async function writeHostDefaultsToExport(
  exportDb: Database.Database,
  userId: string,
): Promise<void> {
  exportDb.exec(`
    CREATE TABLE host_defaults (
      level TEXT NOT NULL,
      folder_name TEXT,
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT
    );
  `);
  const repository = createCurrentHostDefaultsRepository();
  const folders = new Map(
    (await repository.listFolders([userId])).map((folder) => [
      folder.id,
      folder.name,
    ]),
  );
  const insert = exportDb.prepare(
    "INSERT INTO host_defaults (level, folder_name, namespace, key, value) VALUES (?, ?, ?, ?, ?)",
  );
  for (const row of await repository.listOwnedBy(userId)) {
    const folderName =
      row.level === "folder" && row.folderId !== null
        ? folders.get(row.folderId)
        : null;
    if (row.level === "folder" && !folderName) continue;
    insert.run(row.level, folderName, row.namespace, row.key, row.value);
  }
}

export async function importHostDefaults(
  importDb: Database.Database,
  userId: string,
): Promise<{ imported: number; skipped: number }> {
  let rows: Array<{
    level: string;
    folder_name: string | null;
    namespace: string;
    key: string;
    value: string | null;
  }>;
  try {
    rows = importDb.prepare("SELECT * FROM host_defaults").all() as never;
  } catch {
    return { imported: 0, skipped: 0 };
  }

  const groups = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const group =
      row.level === "folder" && row.folder_name
        ? `f:${row.folder_name}`
        : row.level === "user"
          ? "u"
          : null;
    if (!group) continue;
    const values = groups.get(group) ?? {};
    values[`${row.namespace}.${row.key}`] = decodeDefaultValue(row.value);
    groups.set(group, values);
  }

  const permissions = PermissionManager.getInstance();
  const context = {
    actorId: userId,
    ownerId: userId,
    canUseCredential: async (credentialId: number, owner: string) =>
      (await findUsableCredential(credentialId, owner)) !== null,
    canUseHost: async (hostId: number, owner: string) =>
      (await permissions.canAccessHost(owner, hostId, "connect")).hasAccess,
  };

  const repository = createCurrentHostDefaultsRepository();
  let imported = 0;
  let skipped = 0;
  for (const [group, values] of groups) {
    const scope: HostDefaultsScope =
      group === "u"
        ? { level: "user", userId }
        : {
            level: "folder",
            userId,
            folderId: await repository.ensureFolder(userId, group.slice(2)),
          };
    const existing = await readLevel(scope);
    const fresh = Object.fromEntries(
      Object.entries(values).filter(([key]) => !(key in existing)),
    );
    skipped += Object.keys(values).length - Object.keys(fresh).length;
    const change = await validateLevelChange(scope, { set: fresh }, context);
    skipped += Object.keys(change.errors).length;
    if (change.set.size === 0) continue;
    await saveLevel(scope, { ...change, errors: {} }, userId);
    imported += change.set.size;
  }
  return { imported, skipped };
}
