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

/**
 * Marks a drag that starts on remote rows. Within the remote grid a drop is a
 * move; onto the local pane it is a copy (a download). The source has to
 * allow both, because Chromium refuses a drop whose dropEffect is not in
 * effectAllowed without firing any event at all -- the drop just silently
 * does nothing.
 */
export function beginRemoteFilesDrag(
  dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed">,
  remotePaths: string[],
): void {
  const payload: InternalFilesDragPayload = {
    type: "internal_files",
    files: remotePaths,
  };
  dataTransfer.setData("text/plain", JSON.stringify(payload));
  // Lets sibling panes recognise this drag before the payload is readable.
  dataTransfer.setData(REMOTE_FILES_DRAG_MIME, "1");
  dataTransfer.effectAllowed = "copyMove";
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

/** Thrown when a remote name cannot be used as a local path component. */
export class UnsafeLocalNameError extends Error {
  readonly code = "EINVAL";
  constructor(
    readonly name: string,
    readonly reason: string,
  ) {
    super(`Unsafe file name "${name}": ${reason}`);
  }
}

// Windows refuses these device names in any directory, with any extension.
const WINDOWS_RESERVED_NAMES =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.[^.]*)?$/i;

/**
 * Validates one remote path component for use as a single local path
 * segment on the destination platform (`separator` "\\" means Windows).
 *
 * A POSIX file name may legally contain "\\", ":" or end in a dot, all of
 * which Windows treats as separators, drive prefixes or strips — so a remote
 * name like "..\\outside.txt" would otherwise be normalised out of the
 * selected download folder. Anything that is not a plain name is rejected;
 * traversal ("..") and separators are rejected on every platform.
 */
export function assertSafeLocalComponent(
  name: string,
  separator: string,
): string {
  if (name === "" || name === "." || name === "..") {
    throw new UnsafeLocalNameError(name, "empty or traversal component");
  }
  if (name.includes("/") || name.includes("\0")) {
    throw new UnsafeLocalNameError(name, "contains a path separator or NUL");
  }
  if (separator === "\\") {
    if (/[\\:*?"<>|]/.test(name)) {
      throw new UnsafeLocalNameError(
        name,
        "contains a character Windows does not allow in file names",
      );
    }
    if (/[\u0001-\u001f]/.test(name)) {
      throw new UnsafeLocalNameError(name, "contains control characters");
    }
    if (/[. ]$/.test(name)) {
      throw new UnsafeLocalNameError(
        name,
        "Windows strips trailing dots and spaces",
      );
    }
    if (WINDOWS_RESERVED_NAMES.test(name)) {
      throw new UnsafeLocalNameError(name, "reserved device name on Windows");
    }
  }
  return name;
}

function samePathPrefix(a: string, b: string, separator: string): boolean {
  return separator === "\\" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Builds the local destination for a "/"-separated relative remote path
 * under `localDir`, validating every component for the destination platform
 * and asserting the result stays strictly inside `localDir`.
 */
export function buildLocalDestination(
  localDir: string,
  relativePath: string,
  separator: string,
): string {
  const sep = separator || "/";
  const parts = relativePath.split("/").filter((p) => p !== "");
  if (parts.length === 0) {
    throw new UnsafeLocalNameError(relativePath, "empty path");
  }
  const dest = parts.reduce(
    (acc, part) => joinLocalPath(acc, assertSafeLocalComponent(part, sep), sep),
    localDir,
  );
  const root = localDir.endsWith(sep) ? localDir : `${localDir}${sep}`;
  if (
    !samePathPrefix(dest.slice(0, root.length), root, sep) ||
    dest.length <= root.length
  ) {
    throw new UnsafeLocalNameError(
      relativePath,
      "destination escapes the selected folder",
    );
  }
  return dest;
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

const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Formats a local mtime the same way the backend formats remote entries
 * (`formatMtime` in src/backend/hosts/file-manager/utils.ts, i.e. `ls -l`
 * style): `Sep 11 16:25` for the last six months, `Sep 11  2025` before
 * that — so both panes read alike.
 */
export function formatLocalModified(
  timestamp?: number,
  now: Date = new Date(),
): string {
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";
  const month = MONTH_ABBREVIATIONS[date.getMonth()];
  const day = date.getDate().toString().padStart(2, " ");
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  if (date > sixMonthsAgo) {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${month} ${day} ${hours}:${minutes}`;
  }
  return `${month} ${day}  ${date.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Parallel transfers

export const TRANSFER_CONCURRENCY_STORAGE_KEY =
  "termix:file-manager:transfer-concurrency";
export const DEFAULT_TRANSFER_CONCURRENCY = 4;
export const MAX_TRANSFER_CONCURRENCY = 8;

export function clampTransferConcurrency(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_TRANSFER_CONCURRENCY;
  return Math.min(MAX_TRANSFER_CONCURRENCY, Math.max(1, n));
}

/** How many files are transferred at the same time (1 = one after another). */
export function getTransferConcurrency(): number {
  try {
    const raw = localStorage.getItem(TRANSFER_CONCURRENCY_STORAGE_KEY);
    return raw === null
      ? DEFAULT_TRANSFER_CONCURRENCY
      : clampTransferConcurrency(raw);
  } catch {
    return DEFAULT_TRANSFER_CONCURRENCY;
  }
}

export function setTransferConcurrency(value: number): number {
  const clamped = clampTransferConcurrency(value);
  try {
    localStorage.setItem(TRANSFER_CONCURRENCY_STORAGE_KEY, String(clamped));
  } catch {
    // storage unavailable
  }
  return clamped;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving the
 * original order of dispatch. Stops dispatching new items once `shouldStop()`
 * returns true; items already in flight run to completion (the caller
 * cancels those through their own transfer ids). Never rejects because of a
 * single item: worker errors are the worker's business.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  const size = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const lanes = Array.from({ length: size }, async () => {
    while (next < items.length && !shouldStop()) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}
