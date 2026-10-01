import fs from "node:fs/promises";
import path from "node:path";

export function isInside(file: string, dir: string): boolean {
  return path.resolve(file).startsWith(`${path.resolve(dir)}${path.sep}`);
}

/**
 * Moves a finished recording someone else wrote (guacd's, in remote
 * desktop's recordings folder) under this plugin's data folder, which is the
 * only place playback and retention read from. Returns where it ended up;
 * a file that is not there is left alone.
 */
export async function adoptRecordingFile(
  source: string,
  dataDir: string,
): Promise<string> {
  if (isInside(source, dataDir)) return source;
  const target = path.join(
    dataDir,
    "session_recordings",
    path.basename(path.dirname(source)),
    path.basename(source),
  );
  try {
    await fs.access(source);
  } catch {
    return source;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fs.copyFile(source, target);
    await fs.unlink(source);
  }
  return target;
}
