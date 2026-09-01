import type { Host, HostFolder } from "@/types/ui-types";

export function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}

export function hostMatchesQuery(host: Host, query: string) {
  return (
    host.name.toLowerCase().includes(query) ||
    host.ip.toLowerCase().includes(query) ||
    host.username.toLowerCase().includes(query) ||
    host.tags?.some((t) => t.toLowerCase().includes(query))
  );
}

/** Key used in the openFolders/openSet expand-state Set for a host's own children row. */
export function hostExpandKey(host: Host): string {
  return `host:${host.id}`;
}

function hostHasMatch(host: Host, query: string): boolean {
  if (hostMatchesQuery(host, query)) return true;
  return (host.childHosts ?? []).some((child) => hostHasMatch(child, query));
}

export function folderHasMatch(folder: HostFolder, query: string): boolean {
  for (const child of folder.children) {
    if (isFolder(child)) {
      if (folderHasMatch(child, query)) return true;
    } else {
      if (hostHasMatch(child, query)) return true;
    }
  }
  return false;
}

export type VirtualRow = { item: Host | HostFolder; depth: number };

function collectVisibleHostRows(
  host: Host,
  query: string,
  closedHostParents: Set<string>,
  out: VirtualRow[],
  depth: number,
): void {
  if (!query || hostMatchesQuery(host, query) || hostHasMatch(host, query)) {
    out.push({ item: host, depth });
  } else {
    return;
  }
  const childHosts = host.childHosts ?? [];
  if (childHosts.length === 0) return;
  // Sub-host parents default to expanded (opposite of folders): a host that
  // just got reparented shouldn't seem to disappear because its new parent
  // row starts closed. closedHostParents tracks the opposite of openFolders
  // -- parents the user has explicitly collapsed.
  const isOpen = query ? true : !closedHostParents.has(hostExpandKey(host));
  if (!isOpen) return;
  for (const child of childHosts) {
    collectVisibleHostRows(child, query, closedHostParents, out, depth + 1);
  }
}

export function collectVisibleRows(
  children: (Host | HostFolder)[],
  query: string,
  openSet: Set<string>,
  out: VirtualRow[] = [],
  depth = 0,
  closedHostParents: Set<string> = new Set(),
): VirtualRow[] {
  for (const child of children) {
    if (isFolder(child)) {
      const visible = query ? folderHasMatch(child, query) : true;
      if (!visible) continue;
      out.push({ item: child, depth });
      const childOpen = query ? true : openSet.has(child.path ?? child.name);
      if (childOpen)
        collectVisibleRows(
          child.children,
          query,
          openSet,
          out,
          depth + 1,
          closedHostParents,
        );
    } else {
      collectVisibleHostRows(child, query, closedHostParents, out, depth);
    }
  }
  return out;
}

export function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) {
      out.push(...collectAllHosts(child.children));
    } else {
      out.push(child);
      if (child.childHosts && child.childHosts.length > 0) {
        out.push(...collectAllHosts(child.childHosts));
      }
    }
  }
  return out;
}

// Open/close state and folder assignment are both keyed by the full " / " path,
// so two folders that share a leaf name don't collapse together. Synthetic group
// headers (group-by views) are excluded from the assignable-folder list.
export function collectAllFolderPaths(
  children: (Host | HostFolder)[],
): string[] {
  const paths = new Set<string>();
  for (const child of children) {
    if (isFolder(child)) {
      const path = child.path ?? child.name;
      if (!path.startsWith("__group__:")) paths.add(path);
      for (const p of collectAllFolderPaths(child.children)) paths.add(p);
    }
  }
  return Array.from(paths).sort((a, b) => a.localeCompare(b));
}

/** Sentinel parent for rows sitting at the tree root (no folder). */
export const ROOT_PARENT = "__root__";

export function rowKey(item: Host | HostFolder): string {
  return isFolder(item)
    ? `folder:${item.path ?? item.name}`
    : `host:${item.id}`;
}

export function rowKind(key: string): string {
  return key.slice(0, key.indexOf(":"));
}

/**
 * Flattens the visible rows into the parent-scoped shape planReorder needs.
 *
 * Parent is derived from the row's own data rather than from its position in
 * the flattened list: a folder's parent is its path minus the last segment,
 * a host's is its folder (or its parent host when nested as a sub-host).
 * Scoping by parent is what keeps a drop comparing against the neighbours it
 * was actually dropped between.
 */
export function buildReorderRows(
  rows: { item: Host | HostFolder }[],
): { key: string; parentKey: string; sortOrder?: number | null }[] {
  return rows.map(({ item }) => {
    if (isFolder(item)) {
      const path = item.path ?? item.name;
      const cut = path.lastIndexOf(" / ");
      return {
        key: rowKey(item),
        parentKey: cut === -1 ? ROOT_PARENT : `folder:${path.slice(0, cut)}`,
        sortOrder: item.sortOrder,
      };
    }
    const parentKey = item.parentHostId
      ? `host:${item.parentHostId}`
      : item.folder
        ? `folder:${item.folder}`
        : ROOT_PARENT;
    return { key: rowKey(item), parentKey, sortOrder: item.sortOrder };
  });
}

/**
 * Every orderable row in the tree, visible or not, in tree order.
 *
 * Reorder math must run against the complete sibling set: visibleRows omits
 * anything inside a collapsed folder, so planning a drop off it compared the
 * dragged row against a partial group and produced a position that only
 * settled correctly after a second drop.
 */
export function collectOrderableRows(
  children: (Host | HostFolder)[],
  out: { item: Host | HostFolder }[] = [],
): { item: Host | HostFolder }[] {
  for (const child of children) {
    if (isFolder(child)) {
      out.push({ item: child });
      collectOrderableRows(child.children, out);
    } else {
      out.push({ item: child });
      if (child.childHosts?.length) collectOrderableRows(child.childHosts, out);
    }
  }
  return out;
}
