import fs from "node:fs";
import path from "node:path";

/**
 * The first folder on the way to `file`, or the file itself, that other
 * users can't get through. A plugin running as its own user needs that.
 */
export function firstUnreadable(
  file: string,
): { path: string; mode: number } | null {
  if (process.platform === "win32") return null;
  const chain: string[] = [];
  let current = path.resolve(file);
  for (;;) {
    chain.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const entry of chain) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(entry);
    } catch {
      return null;
    }
    const needed = stat.isDirectory() ? 0o001 : 0o004;
    if ((stat.mode & needed) === 0) {
      return { path: entry, mode: stat.mode & 0o777 };
    }
  }
  return null;
}

/**
 * Node reports code its user can't read as "Cannot find module". When core
 * can see the file but the plugin's user can't get to it, say so.
 */
export function explainStartError(pluginId: string, message: string): string {
  if (process.env.TERMIX_PLUGIN_LAUNCHER !== "1") return message;
  const missing = /Cannot find module '([^']+)'/.exec(message)?.[1];
  if (!missing || !fs.existsSync(missing)) return message;
  const blocked = firstUnreadable(missing);
  if (!blocked) return message;
  return (
    `Plugin ${pluginId} can't read its own files: ${blocked.path} has mode ` +
    `${blocked.mode.toString(8)}, so the plugin's user can't open it. Run ` +
    `chmod -R a+rX on the plugins folder and restart the plugin. Storage ` +
    `that does not keep file permissions, like some network shares, can cause this.`
  );
}
