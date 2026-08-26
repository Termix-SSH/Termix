import path from "node:path";

/**
 * Confines a caller-supplied path to a base directory.
 *
 * The database backup/restore endpoint takes `backupPath` and `targetPath`
 * straight from the request body and hands them to `fs` as read and write
 * targets. It is admin-only, but "only an admin can reach it" is not the same
 * as "it cannot escape the data directory": an admin session is exactly what an
 * attacker who lands one wants to turn into arbitrary file read/write on the
 * host. Backups only ever live under DATA_DIR, so nothing legitimate needs to
 * point outside it.
 *
 * Returns the resolved absolute path when it stays within `baseDir`, or null
 * when it escapes -- including via `..`, an absolute path, or a symlink-shaped
 * string. Comparison is done on resolved paths with a trailing separator so
 * that `/data-evil` cannot pass as being inside `/data`.
 */
export function resolveWithinDir(
  baseDir: string,
  candidate: unknown,
): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  if (candidate.includes("\0")) return null;

  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, candidate);

  if (resolved === base) return resolved;
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  return resolved.startsWith(baseWithSep) ? resolved : null;
}
