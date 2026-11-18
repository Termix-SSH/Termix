import fs from "node:fs";
import path from "node:path";

/**
 * Opens an unpacked plugin's code to every user: folders 0755, files 0644.
 * Core runs with umask 077 so its own files stay private, but each plugin
 * runs as its own user in the Docker image and has to read its code. The
 * code is the public release, so nothing here is secret.
 */
export async function makeTreeReadable(dir: string): Promise<void> {
  if (process.platform === "win32") return;
  await fs.promises.chmod(dir, 0o755);
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await makeTreeReadable(full);
    else if (entry.isFile()) await fs.promises.chmod(full, 0o644);
  }
}
