import fs from "node:fs";
import path from "node:path";

export type AdoptFs = Pick<
  typeof fs,
  "lstatSync" | "readdirSync" | "lchownSync" | "chmodSync"
>;

/**
 * Hands a plugin's user what is already in its data folder: files core made
 * there before plugins ran as their own users. Symlinks are never followed and
 * a file with other hard links is left alone, so a plugin can't use this to
 * take over a file outside its folder. Call it while the plugin is stopped.
 * Returns how many entries changed.
 */
export function adoptDataDir(
  dir: string,
  uid: number,
  gid: number,
  io: AdoptFs = fs,
): number {
  let changed = 0;
  const fix = (file: string, stat: fs.Stats, mode: number) => {
    if (stat.uid !== uid || stat.gid !== gid) {
      io.lchownSync(file, uid, gid);
      changed++;
    }
    if ((stat.mode & 0o7777) !== mode) io.chmodSync(file, mode);
  };
  const walk = (current: string) => {
    for (const name of io.readdirSync(current)) {
      const full = path.join(current, name);
      const stat = io.lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        fix(full, stat, 0o2770);
        walk(full);
      } else if (stat.isFile() && stat.nlink === 1) {
        // Core's group keeps read and write, like files the plugin makes.
        fix(full, stat, (stat.mode | 0o660) & 0o770);
      }
    }
  };
  walk(dir);
  return changed;
}

/** Plugin ids whose data folder was handed over, with the uid it went to. */
export function readAdopted(file: string): Record<string, number> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

export function writeAdopted(file: string, map: Record<string, number>): void {
  fs.writeFileSync(file, JSON.stringify(map), { mode: 0o600 });
}
