import fs from "node:fs";
import path from "node:path";

function inside(base: string, full: string): boolean {
  const relative = path.relative(base, full);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function real(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    // A file that does not exist yet: resolve its folder instead.
    return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  }
}

export interface RestorePaths {
  backupPath: string;
  targetPath?: string;
}

/**
 * Both restore paths must stay inside the data folder, after following
 * symlinks. Returns null when either one leaves it.
 */
export function resolveRestorePaths(
  dataDir: string,
  backupPath: unknown,
  targetPath: unknown,
): RestorePaths | null {
  if (typeof backupPath !== "string" || !backupPath) return null;
  if (targetPath !== undefined && targetPath !== null && targetPath !== "") {
    if (typeof targetPath !== "string") return null;
  } else {
    targetPath = undefined;
  }
  let base: string;
  try {
    base = fs.realpathSync(dataDir);
  } catch {
    return null;
  }
  try {
    const backup = real(path.resolve(base, backupPath));
    if (!inside(base, backup)) return null;
    if (targetPath === undefined) return { backupPath: backup };
    const target = real(path.resolve(base, targetPath as string));
    if (!inside(base, target)) return null;
    return { backupPath: backup, targetPath: target };
  } catch {
    return null;
  }
}
