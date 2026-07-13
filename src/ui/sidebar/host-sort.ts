import type { Host, HostFolder } from "@/types/ui-types";

export type SortKey =
  | "default"
  | "name-asc"
  | "name-desc"
  | "ip-asc"
  | "ip-desc"
  | "status-online"
  | "status-offline";

const SORT_KEYS = new Set<SortKey>([
  "default",
  "name-asc",
  "name-desc",
  "ip-asc",
  "ip-desc",
  "status-online",
  "status-offline",
]);

export function resolveHostSortPreferences(
  savedSortKey: string | null,
  savedPinnedFirst: string | null,
): { sortKey: SortKey; pinnedFirst: boolean } {
  const legacyPinned = savedSortKey === "pinned";
  return {
    sortKey: SORT_KEYS.has(savedSortKey as SortKey)
      ? (savedSortKey as SortKey)
      : "default",
    pinnedFirst:
      savedPinnedFirst === null ? legacyPinned : savedPinnedFirst === "true",
  };
}

function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}

export function sortHostTree(
  folder: HostFolder,
  key: SortKey,
  pinnedFirst = false,
): HostFolder {
  if (key === "default" && !pinnedFirst) return folder;

  const comparator = (a: Host | HostFolder, b: Host | HostFolder): number => {
    const aIsFolder = isFolder(a);
    const bIsFolder = isFolder(b);
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    if (aIsFolder && bIsFolder) return a.name.localeCompare(b.name);

    if (pinnedFirst && !!a.pin !== !!b.pin) return b.pin ? 1 : -1;

    switch (key) {
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "name-desc":
        return b.name.localeCompare(a.name);
      case "ip-asc":
        return a.ip.localeCompare(b.ip);
      case "ip-desc":
        return b.ip.localeCompare(a.ip);
      case "status-online":
        return Number(b.online) - Number(a.online);
      case "status-offline":
        return Number(a.online) - Number(b.online);
      case "default":
        return 0;
    }
  };

  return {
    ...folder,
    children: [...folder.children]
      .sort(comparator)
      .map((child) =>
        isFolder(child) ? sortHostTree(child, key, pinnedFirst) : child,
      ),
  };
}
