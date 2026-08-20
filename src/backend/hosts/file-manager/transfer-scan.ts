import { basename, joinPath } from "../transfer-paths.js";
import {
  SFTP_OPEN_READ,
  promisifySftpClose,
  promisifySftpOpen,
  promisifySftpReaddir,
  promisifySftpStat,
} from "./sftp-promisify.js";

type SFTPWrapper = import("ssh2").SFTPWrapper;

export interface FileWorkItem {
  sourcePath: string;
  destPath: string;
  mode: number;
  size: number;
}

export async function collectFileWorkItems(
  sftp: SFTPWrapper,
  sourcePath: string,
  destRoot: string,
  destBaseName?: string,
): Promise<FileWorkItem[]> {
  const stats = await promisifySftpStat(sftp, sourcePath);
  const name = destBaseName ?? basename(sourcePath);
  const destPath = joinPath(destRoot, name);

  if (stats.isFile()) {
    return [
      {
        sourcePath,
        destPath,
        mode: stats.mode & 0o7777,
        size: stats.size,
      },
    ];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const items: FileWorkItem[] = [];
  const walk = async (srcDir: string, dstDir: string) => {
    const entries = await promisifySftpReaddir(sftp, srcDir);
    for (const entry of entries) {
      if (entry.filename === "." || entry.filename === "..") continue;
      const srcChild = joinPath(srcDir, entry.filename);
      const dstChild = joinPath(dstDir, entry.filename);

      if (entry.attrs.isDirectory()) {
        await walk(srcChild, dstChild);
      } else if (entry.attrs.isFile()) {
        items.push({
          sourcePath: srcChild,
          destPath: dstChild,
          mode: entry.attrs.mode & 0o7777,
          size: entry.attrs.size,
        });
      }
    }
  };

  await walk(sourcePath, destPath);
  return items;
}

export async function readSftpSample(
  sftp: SFTPWrapper,
  path: string,
  fileSize: number,
): Promise<Buffer> {
  const sampleSize = Math.min(64 * 1024, fileSize);
  const position = Math.max(0, Math.floor((fileSize - sampleSize) / 2));
  const handle = await promisifySftpOpen(sftp, path, SFTP_OPEN_READ, 0o666);
  try {
    const buffer = Buffer.alloc(sampleSize);
    const bytesRead = await new Promise<number>((resolve, reject) => {
      sftp.read(handle, buffer, 0, sampleSize, position, (err, count) => {
        if (err) reject(err);
        else resolve(count);
      });
    });
    return buffer.subarray(0, bytesRead);
  } finally {
    await promisifySftpClose(sftp, handle).catch(() => {});
  }
}
