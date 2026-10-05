import type { Credential, Host } from "@/types/ui-types";

/**
 * The Manage list as a tree: folders from the " / " path, sub-hosts under
 * their parent host.
 */

export type ManageItem = {
  id: string;
  name: string;
  /** IP for a host, username for a credential. */
  note: string;
  /** Extra search text, e.g. tags. */
  search: string;
  online?: boolean;
  children: ManageItem[];
};

export type ManageFolder = {
  /** Full " / " path, unique across the tree. */
  path: string;
  /** Last segment, what the row shows. */
  name: string;
  folders: ManageFolder[];
  items: ManageItem[];
};

export type ManageRow =
  | {
      kind: "folder";
      depth: number;
      folder: ManageFolder;
      count: number;
      online: number;
    }
  | { kind: "item"; depth: number; item: ManageItem; folderPath: string };

function emptyFolder(path: string, name: string): ManageFolder {
  return { path, name, folders: [], items: [] };
}

/** Walks to the folder at `path`, creating each missing segment on the way. */
function folderAt(
  root: ManageFolder,
  index: Map<string, ManageFolder>,
  path: string,
) {
  if (!path) return root;
  const existing = index.get(path);
  if (existing) return existing;

  let current = root;
  let accumulated = "";
  for (const part of path.split(" / ")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    accumulated = accumulated ? `${accumulated} / ${trimmed}` : trimmed;
    let next = index.get(accumulated);
    if (!next) {
      next = emptyFolder(accumulated, trimmed);
      index.set(accumulated, next);
      current.folders.push(next);
    }
    current = next;
  }
  return current;
}

export function buildHostManageTree(
  hosts: Host[],
  isOnline: (host: Host) => boolean = (host) => host.online,
): ManageFolder {
  const root = emptyFolder("", "");
  const index = new Map<string, ManageFolder>();

  const toItem = (host: Host): ManageItem => ({
    id: host.id,
    name: host.name || host.ip,
    note: host.ip,
    search: `${host.username} ${(host.tags ?? []).join(" ")}`,
    online: isOnline(host),
    children: [],
  });

  const items = new Map(hosts.map((h) => [h.id, toItem(h)]));

  // A parent that is gone or would close a loop drops the host back to its
  // folder, the same as buildHostTree.
  const byId = new Map(hosts.map((h) => [h.id, h]));
  const isDescendant = (candidate: string, ancestor: string) => {
    const seen = new Set<string>();
    let current: string | null | undefined = candidate;
    while (current) {
      if (current === ancestor) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      current = byId.get(current)?.parentHostId;
    }
    return false;
  };

  const nested = new Set<string>();
  for (const host of hosts) {
    if (!host.parentHostId) continue;
    const parent = items.get(host.parentHostId);
    if (!parent) continue;
    if (isDescendant(host.parentHostId, host.id)) continue;
    parent.children.push(items.get(host.id)!);
    nested.add(host.id);
  }

  for (const host of hosts) {
    if (nested.has(host.id)) continue;
    folderAt(root, index, host.folder ?? "").items.push(items.get(host.id)!);
  }
  return sortFolder(root);
}

export function buildCredentialManageTree(
  credentials: Credential[],
): ManageFolder {
  const root = emptyFolder("", "");
  const index = new Map<string, ManageFolder>();

  for (const cred of credentials) {
    folderAt(root, index, cred.folder ?? "").items.push({
      id: cred.id,
      name: cred.name,
      note: cred.username,
      search: `${cred.type} ${(cred.tags ?? []).join(" ")}`,
      children: [],
    });
  }
  return sortFolder(root);
}

function sortFolder(folder: ManageFolder): ManageFolder {
  folder.folders.sort((a, b) => a.name.localeCompare(b.name));
  folder.items.sort((a, b) => a.name.localeCompare(b.name));
  folder.folders.forEach(sortFolder);
  return folder;
}

function itemMatches(item: ManageItem, needle: string): boolean {
  if (`${item.name} ${item.note} ${item.search}`.toLowerCase().includes(needle))
    return true;
  return item.children.some((child) => itemMatches(child, needle));
}

/** Total items in a folder and its subfolders, plus how many are online. */
export function folderCounts(folder: ManageFolder): {
  count: number;
  online: number;
} {
  let count = 0;
  let online = 0;
  const walk = (item: ManageItem) => {
    count++;
    if (item.online) online++;
    item.children.forEach(walk);
  };
  folder.items.forEach(walk);
  for (const child of folder.folders) {
    const sub = folderCounts(child);
    count += sub.count;
    online += sub.online;
  }
  return { count, online };
}

/** The rows actually drawn. While searching, folders holding a match open on their own. */
export function flattenTree(
  folder: ManageFolder,
  open: Set<string>,
  needle: string,
  depth = 0,
  rows: ManageRow[] = [],
): ManageRow[] {
  for (const child of folder.folders) {
    const counts = folderCounts(child);
    const matching = filterFolder(child, needle);
    if (!matching) continue;
    rows.push({
      kind: "folder",
      depth,
      folder: child,
      count: counts.count,
      online: counts.online,
    });
    if (needle || open.has(child.path))
      flattenTree(matching, open, needle, depth + 1, rows);
  }

  for (const item of folder.items) {
    if (needle && !itemMatches(item, needle)) continue;
    pushItem(item, folder.path, depth, open, needle, rows);
  }
  return rows;
}

function pushItem(
  item: ManageItem,
  folderPath: string,
  depth: number,
  open: Set<string>,
  needle: string,
  rows: ManageRow[],
) {
  rows.push({ kind: "item", depth, item, folderPath });
  if (item.children.length === 0) return;
  if (!needle && !open.has(item.id)) return;
  for (const child of item.children) {
    if (needle && !itemMatches(child, needle)) continue;
    pushItem(child, folderPath, depth + 1, open, needle, rows);
  }
}

/** Drops folders with nothing matching, so search never leaves empty headers. */
function filterFolder(
  folder: ManageFolder,
  needle: string,
): ManageFolder | null {
  if (!needle) return folder;
  const folders = folder.folders
    .map((child) => filterFolder(child, needle))
    .filter((child): child is ManageFolder => child !== null);
  const items = folder.items.filter((item) => itemMatches(item, needle));
  if (folders.length === 0 && items.length === 0) return null;
  return { ...folder, folders, items };
}

/** Every folder path in the tree, for expand-all and the default open set. */
export function allFolderPaths(
  folder: ManageFolder,
  out: string[] = [],
): string[] {
  for (const child of folder.folders) {
    out.push(child.path);
    allFolderPaths(child, out);
  }
  return out;
}

/** Every parent host id, so sub-hosts can start expanded too. */
export function allParentIds(
  folder: ManageFolder,
  out: string[] = [],
): string[] {
  const walk = (item: ManageItem) => {
    if (item.children.length > 0) out.push(item.id);
    item.children.forEach(walk);
  };
  folder.items.forEach(walk);
  folder.folders.forEach((child) => allParentIds(child, out));
  return out;
}
