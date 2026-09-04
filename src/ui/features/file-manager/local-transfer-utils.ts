// Pure helpers shared by the dual-pane (local <-> remote) file manager code.
// Kept free of React/DOM so they can be unit tested directly.

import type { LocalFileEntry } from "@/types/electron";

/** Custom MIME type carried by drags that originate in the local pane. */
export const LOCAL_FILES_DRAG_MIME = "application/x-termix-local-files";

/**
 * Custom MIME type the remote grid adds to its internal drags so other panes
 * can recognise them during dragenter/dragover (when payloads are unreadable).
 */
export const REMOTE_FILES_DRAG_MIME = "application/x-termix-remote-files";

export interface LocalFilesDragPayload {
  type: "local_files";
  paths: string[];
}

export interface InternalFilesDragPayload {
  type: "internal_files";
  files: string[];
}

export function serializeLocalFilesDragPayload(paths: string[]): string {
  const payload: LocalFilesDragPayload = { type: "local_files", paths };
  return JSON.stringify(payload);
}

export function parseLocalFilesDragPayload(
  raw: string | null | undefined,
): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalFilesDragPayload>;
    if (parsed?.type !== "local_files" || !Array.isArray(parsed.paths)) {
      return null;
    }
    const paths = parsed.paths.filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    return paths.length > 0 ? paths : null;
  } catch {
    return null;
  }
}

/** Parses the payload the remote grid puts on `text/plain` for internal drags. */
export function parseInternalFilesDragPayload(
  raw: string | null | undefined,
): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InternalFilesDragPayload>;
    if (parsed?.type !== "internal_files" || !Array.isArray(parsed.files)) {
      return null;
    }
    const files = parsed.files.filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

/** True while a drag that started in the local pane is over the element. */
export function isLocalFilesDrag(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined,
): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes(LOCAL_FILES_DRAG_MIME);
}

/** True while a drag that started in the remote grid is over the element. */
export function isRemoteFilesDrag(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined,
): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes(REMOTE_FILES_DRAG_MIME);
}

/** Joins a POSIX remote directory with one or more path segments. */
export function joinRemotePath(base: string, ...segments: string[]): string {
  let out = base || "/";
  for (const segment of segments) {
    const clean = segment.replace(/^\/+|\/+$/g, "");
    if (!clean) continue;
    out = out.endsWith("/") ? `${out}${clean}` : `${out}/${clean}`;
  }
  return out;
}

/** Joins a local directory and a file name using the platform separator. */
export function joinLocalPath(
  base: string,
  name: string,
  separator: string,
): string {
  const sep = separator || "/";
  const trimmedBase = base.endsWith(sep) ? base.slice(0, -sep.length) : base;
  // Root on POSIX is "/" which trims to ""; keep the separator in that case.
  return `${trimmedBase}${sep}${name}`;
}

export function remoteBaseName(remotePath: string): string {
  const trimmed = remotePath.replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed || "/";
}

/**
 * Given the "/"-separated relative paths of files being uploaded (each
 * including its top-level root name) plus any empty directories, returns the
 * set of directories that must exist on the remote, shallowest first, so each
 * parent is created before its children.
 */
export function planRemoteDirectories(
  fileRelativePaths: string[],
  emptyDirs: string[] = [],
): string[] {
  const dirs = new Set<string>();

  for (const relativePath of fileRelativePaths) {
    const parts = relativePath.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  for (const dir of emptyDirs) {
    const parts = dir.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }

  return Array.from(dirs).sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
}

/** Remote directory a file with the given relative path should land in. */
export function remoteDirForRelativePath(
  base: string,
  relativePath: string,
): string {
  const idx = relativePath.lastIndexOf("/");
  if (idx <= 0) return base;
  return joinRemotePath(base, relativePath.slice(0, idx));
}

/** Short "Kind" column label, in the spirit of Finder / Termius. */
export function describeLocalKind(
  entry: Pick<LocalFileEntry, "name" | "type">,
): string {
  if (entry.type === "directory") return "folder";
  if (entry.type === "link") return "link";
  const dot = entry.name.lastIndexOf(".");
  if (dot > 0 && dot < entry.name.length - 1) {
    return entry.name.slice(dot + 1).toLowerCase();
  }
  return "file";
}

export type LocalSortField = "name" | "modified" | "size" | "kind";

export function sortLocalEntries(
  entries: LocalFileEntry[],
  field: LocalSortField,
  order: "asc" | "desc",
): LocalFileEntry[] {
  const dir = order === "asc" ? 1 : -1;
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return [...entries].sort((a, b) => {
    // Folders always group first, matching the remote grid.
    const aDir = a.type === "directory" ? 0 : 1;
    const bDir = b.type === "directory" ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;

    let cmp = 0;
    switch (field) {
      case "modified":
        cmp = (a.modifiedTimestamp ?? 0) - (b.modifiedTimestamp ?? 0);
        break;
      case "size":
        cmp = a.size - b.size;
        break;
      case "kind":
        cmp = collator.compare(describeLocalKind(a), describeLocalKind(b));
        break;
      default:
        cmp = 0;
    }
    if (cmp === 0) cmp = collator.compare(a.name, b.name);
    return cmp * dir;
  });
}

export function formatLocalModified(timestamp?: number): string {
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
