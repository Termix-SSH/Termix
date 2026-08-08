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

export function folderHasMatch(folder: HostFolder, query: string): boolean {
  for (const child of folder.children) {
    if (isFolder(child)) {
      if (folderHasMatch(child, query)) return true;
    } else {
      if (hostMatchesQuery(child, query)) return true;
    }
  }
  return false;
}

export type VirtualRow = { item: Host | HostFolder; depth: number };

export function collectVisibleRows(
  children: (Host | HostFolder)[],
  query: string,
  openSet: Set<string>,
  out: VirtualRow[] = [],
  depth = 0,
): VirtualRow[] {
  for (const child of children) {
    if (isFolder(child)) {
      const visible = query ? folderHasMatch(child, query) : true;
      if (!visible) continue;
      out.push({ item: child, depth });
      const childOpen = query ? true : openSet.has(child.path ?? child.name);
      if (childOpen)
        collectVisibleRows(child.children, query, openSet, out, depth + 1);
    } else {
      if (!query || hostMatchesQuery(child, query))
        out.push({ item: child, depth });
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
    }
  }
  return out;
}

// Open/close state and folder assignment are both keyed by the full " / " path,
// so two folders that share a leaf name don't collapse together. Synthetic group
// headers (group-by views) are excluded from the assignable-folder list.
export function collectAllFolderPaths(children: (Host | HostFolder)[]): string[] {
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
