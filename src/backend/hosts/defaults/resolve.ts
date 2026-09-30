/**
 * Host default resolution. No database access: the levels come in as maps,
 * so every rule here is testable on its own.
 *
 * A key resolves from the deepest folder a host sits in up to its root
 * folder, then the owner's own defaults, then the server's, then the key's
 * built-in value. A level the key does not allow is skipped.
 */

import {
  defaultValuesEqual,
  type HostDefaultSource,
  type ResolvedHostDefault,
} from "../../../types/host-defaults.js";
import type { DefaultKeyInfo } from "./catalog.js";

export type LevelMap = Map<string, unknown>;

export interface FolderLevel {
  folderId: number;
  name: string;
  values: LevelMap;
}

export interface HostLevels {
  admin: LevelMap;
  user: LevelMap;
  /** Root first, deepest last. */
  folders: FolderLevel[];
}

export const FOLDER_SEPARATOR = " / ";

/** "A / B / C" -> ["A", "A / B", "A / B / C"]. */
export function folderChainPaths(path: string | null | undefined): string[] {
  if (!path) return [];
  const segments = path.split(FOLDER_SEPARATOR).filter(Boolean);
  return segments.map((_, index) =>
    segments.slice(0, index + 1).join(FOLDER_SEPARATOR),
  );
}

export interface HostPlacement {
  folder: string | null;
  parentHostId: number | null;
}

/**
 * The folder whose defaults a host follows. A sub-host has no folder of its
 * own, so it takes the nearest ancestor's.
 */
export function effectiveFolderPath(
  hostId: number,
  placement: Map<number, HostPlacement>,
): string | null {
  const seen = new Set<number>();
  let current: number | null = hostId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const own = placement.get(current);
    if (!own) return null;
    if (own.folder) return own.folder;
    current = own.parentHostId;
  }
  return null;
}

export function resolveKey(
  info: DefaultKeyInfo,
  levels: HostLevels,
): ResolvedHostDefault | undefined {
  const allowed = new Set(info.levels);
  if (allowed.has("folder")) {
    for (let i = levels.folders.length - 1; i >= 0; i--) {
      const folder = levels.folders[i];
      if (folder.values.has(info.fullKey)) {
        return {
          value: info.normalize(folder.values.get(info.fullKey)),
          source: {
            level: "folder",
            folderId: folder.folderId,
            folderName: folder.name,
          },
        };
      }
    }
  }
  const order: Array<["user" | "admin", LevelMap]> = [
    ["user", levels.user],
    ["admin", levels.admin],
  ];
  for (const [level, values] of order) {
    if (allowed.has(level) && values.has(info.fullKey)) {
      return {
        value: info.normalize(values.get(info.fullKey)),
        source: { level },
      };
    }
  }
  if (info.builtin === undefined) return undefined;
  const source: HostDefaultSource = { level: "builtin" };
  return { value: info.normalize(info.builtin), source };
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Whether a host's value is its own rather than the default: it differs from
 * what resolves, or nothing resolves and the host has a value at all.
 */
export function isOwnValue(
  info: DefaultKeyInfo,
  hostValue: unknown,
  resolved: ResolvedHostDefault | undefined,
): boolean {
  const own = info.normalize(hostValue);
  if (!resolved) return !isEmpty(own);
  return !defaultValuesEqual(own, resolved.value);
}

/** A host never jumps through itself, even when a folder default says to. */
export function withoutSelfJump(value: unknown, hostId: number): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter(
    (entry) => Number((entry as { hostId?: unknown })?.hostId) !== hostId,
  );
}
