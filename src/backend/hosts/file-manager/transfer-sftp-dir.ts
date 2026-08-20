import {
  buildPathFromSegments,
  joinPath,
  normalizeSftpPath,
  splitPathSegments,
} from "../transfer-paths.js";
import { isRootOnlyPath } from "./transfer-host-utils.js";
import {
  promisifySftpMkdir,
  promisifySftpReaddir,
  promisifySftpRmdir,
  promisifySftpStat,
  promisifySftpUnlink,
} from "./sftp-promisify.js";

type SFTPWrapper = import("ssh2").SFTPWrapper;

export async function ensureDirectoryTreeSftp(
  sftp: SFTPWrapper,
  dirPath: string,
  created: Set<string> = new Set(),
): Promise<void> {
  const normalized = normalizeSftpPath(dirPath);
  if (!normalized || isRootOnlyPath(normalized)) return;

  const { root, segments } = splitPathSegments(normalized);
  if (segments.length === 0) return;

  for (let i = 0; i < segments.length; i++) {
    const current = buildPathFromSegments(root, segments, i + 1);
    if (created.has(current)) continue;

    try {
      await promisifySftpMkdir(sftp, current, 0o755);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        try {
          const stats = await promisifySftpStat(sftp, current);
          if (!stats.isDirectory()) throw err;
        } catch {
          throw err;
        }
      }
    }
    created.add(current);
  }
}

export async function deletePathSftp(
  sftp: SFTPWrapper,
  path: string,
): Promise<void> {
  let stats: import("ssh2").Stats;
  try {
    stats = await promisifySftpStat(sftp, path);
  } catch {
    return;
  }

  if (stats.isDirectory()) {
    const entries = await promisifySftpReaddir(sftp, path);
    for (const entry of entries) {
      if (entry.filename === "." || entry.filename === "..") continue;
      await deletePathSftp(sftp, joinPath(path, entry.filename));
    }
    await promisifySftpRmdir(sftp, path);
    return;
  }

  if (stats.isFile()) {
    await promisifySftpUnlink(sftp, path);
  }
}
