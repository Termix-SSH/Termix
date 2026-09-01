import type { Host, HostFolder } from "@/types/ui-types";
import type { SortKey } from "@/types/host-sidebar-preferences";

export type { SortKey };

const SORT_KEYS = new Set<SortKey>([
  "default",
  "name-asc",
  "name-desc",
  "ip-asc",
  "ip-desc",
  "status-online",
  "status-offline",
  "manual",
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
    if (aIsFolder && bIsFolder) {
      if (key === "manual") {
        const aOrder = a.sortOrder;
        const bOrder = b.sortOrder;
        if (aOrder == null && bOrder == null)
          return a.name.localeCompare(b.name);
        if (aOrder == null) return 1;
        if (bOrder == null) return -1;
        return aOrder - bOrder;
      }
      return a.name.localeCompare(b.name);
    }

    // The three branches above return for every combination involving a
    // folder, so both sides are hosts from here on.
    const hostA = a as Host;
    const hostB = b as Host;

    if (pinnedFirst && !!hostA.pin !== !!hostB.pin) return hostB.pin ? 1 : -1;

    switch (key) {
      case "name-asc":
        return hostA.name.localeCompare(hostB.name);
      case "name-desc":
        return hostB.name.localeCompare(hostA.name);
      case "ip-asc":
        return hostA.ip.localeCompare(hostB.ip);
      case "ip-desc":
        return hostB.ip.localeCompare(hostA.ip);
      case "status-online":
        return Number(hostB.online) - Number(hostA.online);
      case "status-offline":
        return Number(hostA.online) - Number(hostB.online);
      case "manual": {
        const aOrder = hostA.sortOrder;
        const bOrder = hostB.sortOrder;
        if (aOrder == null && bOrder == null)
          return hostA.name.localeCompare(hostB.name);
        if (aOrder == null) return 1;
        if (bOrder == null) return -1;
        return aOrder - bOrder;
      }
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
