/**
 * Local filesystem helpers for plugins on the desktop app's embedded backend.
 * Ported from the old Electron local-files module. The path rules are the
 * security part: a download can never leave the folder the user picked, links
 * inside it are refused, and a download never replaces a file by accident.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  PluginLocalDirEntry,
  PluginLocalDownload,
  PluginLocalWalkResult,
} from "@termix-ssh/plugin-sdk/backend";

export class LocalFileError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalFileError";
    this.code = code;
  }
}

type PathImpl = typeof path;

export function normalizeLocalPath(candidate: unknown): string {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error("A local absolute path is required");
  }
  return path.normalize(candidate);
}

// A single path segment: no separators, not "." / "..", no NULs.
export function requireEntryName(name: unknown, what: string): string {
  const safeName = String(name || "").trim();
  if (
    !safeName ||
    safeName === "." ||
    safeName === ".." ||
    /[/\\\0]/.test(safeName)
  ) {
    throw new Error(`Invalid ${what}`);
  }
  return safeName;
}

// pathImpl is injectable so the Windows rules can be tested on any OS.
export function assertWithinRoot(
  rootPath: string,
  candidate: string,
  pathImpl: PathImpl = path,
): string {
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    throw new LocalFileError("EINVAL", "A download folder is required");
  }
  const root = pathImpl.normalize(pathImpl.resolve(rootPath));
  const target = pathImpl.normalize(pathImpl.resolve(candidate));
  const rel = pathImpl.relative(root, target);
  const escapes =
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${pathImpl.sep}`) ||
    pathImpl.isAbsolute(rel) ||
    rel.split(pathImpl.sep).some((seg) => seg === ".." || seg === "");
  if (escapes) {
    throw new LocalFileError(
      "EINVAL",
      `"${pathImpl.basename(candidate)}" would be written outside the selected folder`,
    );
  }
  return target;
}

// Resolve a deliberately selected root once, but never follow links supplied
// as descendants of a downloaded tree.
export async function prepareDownloadPath(
  rootPath: string,
  candidate: string,
  directory = false,
): Promise<{ root: string; path: string }> {
  const target = assertWithinRoot(rootPath, normalizeLocalPath(candidate));
  const selected = path.resolve(rootPath);
  const realRoot = await fsp.realpath(selected);
  if (!(await fsp.stat(realRoot)).isDirectory()) {
    throw new LocalFileError("EINVAL", "The download root is not a directory");
  }
  const parts = path.relative(selected, target).split(path.sep);
  let current = realRoot;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const needsDirectory = directory || i < parts.length - 1;
    if (needsDirectory) {
      await fsp.mkdir(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
    const stat = await fsp
      .lstat(current)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" && !needsDirectory) return null;
        throw error;
      });
    if (stat?.isSymbolicLink()) {
      throw new LocalFileError(
        "EINVAL",
        "Downloads cannot follow links inside the selected folder",
      );
    }
    if (needsDirectory && !stat?.isDirectory()) {
      throw new LocalFileError(
        "ENOTDIR",
        "A download parent is not a directory",
      );
    }
  }
  return { root: realRoot, path: current };
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function describeEntry(
  dirPath: string,
  dirent: fs.Dirent,
): Promise<PluginLocalDirEntry> {
  const entryPath = path.join(dirPath, dirent.name);
  let type: PluginLocalDirEntry["type"] = "file";
  let size = 0;
  let modifiedTimestamp: number | undefined;
  let linkTarget: string | undefined;

  try {
    if (dirent.isSymbolicLink()) {
      type = "link";
      try {
        linkTarget = await fsp.readlink(entryPath);
      } catch {
        // dangling or unreadable link
      }
      try {
        const target = await fsp.stat(entryPath);
        if (target.isDirectory()) type = "directory";
        size = target.size;
        modifiedTimestamp = target.mtimeMs;
      } catch {
        const own = await fsp.lstat(entryPath);
        modifiedTimestamp = own.mtimeMs;
      }
    } else if (dirent.isDirectory()) {
      type = "directory";
      modifiedTimestamp = (await fsp.stat(entryPath)).mtimeMs;
    } else {
      const stat = await fsp.stat(entryPath);
      size = stat.size;
      modifiedTimestamp = stat.mtimeMs;
    }
  } catch {
    // Unreadable entry: still list it so the user sees it exists.
  }

  return {
    name: dirent.name,
    path: entryPath,
    type,
    size,
    modifiedTimestamp,
    linkTarget,
    hidden: dirent.name.startsWith("."),
  };
}

export async function listDirectory(dirPath: string): Promise<{
  path: string;
  parent: string | null;
  entries: PluginLocalDirEntry[];
}> {
  const resolved = normalizeLocalPath(dirPath);
  const dirents = await fsp.readdir(resolved, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map((dirent) => describeEntry(resolved, dirent)),
  );
  const parent = path.dirname(resolved);
  return {
    path: resolved,
    parent: parent === resolved ? null : parent,
    entries,
  };
}

// Expands dropped local paths into a flat file list with paths relative to the
// drop root, plus empty directories.
export async function walkPaths(
  rootPaths: string[],
): Promise<PluginLocalWalkResult> {
  const files: PluginLocalWalkResult["files"] = [];
  const emptyDirs: string[] = [];
  let totalBytes = 0;

  async function walkDir(absDir: string, relDir: string): Promise<void> {
    const dirents = await fsp.readdir(absDir, { withFileTypes: true });
    if (dirents.length === 0) {
      emptyDirs.push(relDir);
      return;
    }
    for (const dirent of dirents) {
      const abs = path.join(absDir, dirent.name);
      const rel = `${relDir}/${dirent.name}`;
      if (dirent.isDirectory()) {
        await walkDir(abs, rel);
      } else if (dirent.isFile()) {
        const stat = await fsp.stat(abs);
        files.push({ localPath: abs, relativePath: rel, size: stat.size });
        totalBytes += stat.size;
      } else if (dirent.isSymbolicLink()) {
        try {
          const stat = await fsp.stat(abs);
          if (stat.isFile()) {
            files.push({ localPath: abs, relativePath: rel, size: stat.size });
            totalBytes += stat.size;
          }
        } catch {
          // dangling link: skip
        }
      }
    }
  }

  for (const rootPath of rootPaths) {
    const abs = normalizeLocalPath(rootPath);
    const stat = await fsp.stat(abs);
    const name = path.basename(abs);
    if (stat.isDirectory()) {
      await walkDir(abs, name);
    } else if (stat.isFile()) {
      files.push({ localPath: abs, relativePath: name, size: stat.size });
      totalBytes += stat.size;
    }
  }

  return { files, emptyDirs, totalBytes };
}

export async function homeInfo(): Promise<{
  home: string;
  separator: string;
  platform: NodeJS.Platform;
}> {
  return {
    home: os.homedir(),
    separator: path.sep,
    platform: process.platform,
  };
}

export async function makeDirectory(
  parentPath: string,
  name: string,
): Promise<string> {
  const target = path.join(
    normalizeLocalPath(parentPath),
    requireEntryName(name, "folder name"),
  );
  await fsp.mkdir(target);
  return target;
}

export async function createEmptyFile(
  parentPath: string,
  name: string,
): Promise<string> {
  const target = path.join(
    normalizeLocalPath(parentPath),
    requireEntryName(name, "file name"),
  );
  // "wx" fails if the file already exists rather than truncating it.
  await fsp.writeFile(target, "", { flag: "wx" });
  return target;
}

// Exclusive rename: a destination that appeared meanwhile is never replaced.
export async function renameLocalPath(
  source: string,
  target: string,
): Promise<void> {
  if (source === target) return;
  try {
    await fsp.lstat(target);
    throw new LocalFileError(
      "EEXIST",
      "A file or folder with that name already exists",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if ((await fsp.lstat(source)).isDirectory()) {
    await fsp.rename(source, target);
    return;
  }
  await fsp.link(source, target);
  await fsp.unlink(source);
}

export async function renameEntry(
  oldPath: string,
  newName: string,
): Promise<string> {
  const source = normalizeLocalPath(oldPath);
  const safeName = requireEntryName(newName, "name");
  const target = path.join(path.dirname(source), safeName);
  if (target === source) return source;
  if (await pathExists(target)) {
    throw new LocalFileError("EEXIST", `"${safeName}" already exists`);
  }
  await renameLocalPath(source, target);
  return target;
}

export async function ensureDirectory(
  dirPath: string,
  rootPath?: string,
): Promise<string> {
  let target = normalizeLocalPath(dirPath);
  if (rootPath !== undefined) {
    target = (await prepareDownloadPath(rootPath, target, true)).path;
  } else {
    await fsp.mkdir(target, { recursive: true });
  }
  return target;
}

export async function existingPaths(paths: string[]): Promise<string[]> {
  if (!Array.isArray(paths)) throw new Error("Expected a list of paths");
  const existing: string[] = [];
  for (const candidate of paths) {
    const target = normalizeLocalPath(candidate);
    if (await pathExists(target)) existing.push(target);
  }
  return existing;
}

export async function openRead(
  localPath: string,
): Promise<{ stream: fs.ReadStream; size: number }> {
  const absPath = normalizeLocalPath(localPath);
  const stat = await fsp.stat(absPath);
  if (!stat.isFile()) throw new Error("Only regular files can be uploaded");
  return {
    stream: fs.createReadStream(absPath, { highWaterMark: 1024 * 1024 }),
    size: stat.size,
  };
}

// Destinations with a download in flight, so two transfers never race onto
// the same file.
const activeDestinations = new Set<string>();

function transferToken(transferId: string): string {
  return (
    String(transferId)
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 48) || "transfer"
  );
}

export interface PublishFs {
  rename: (from: string, to: string) => Promise<void>;
  link: (from: string, to: string) => Promise<void>;
  copyFileExcl: (from: string, to: string) => Promise<void>;
  rm: (target: string) => Promise<void>;
  lstat: (target: string) => Promise<fs.Stats>;
}

export const defaultPublishFs: PublishFs = Object.freeze({
  rename: (from, to) => fsp.rename(from, to),
  link: (from, to) => fsp.link(from, to),
  copyFileExcl: (from, to) =>
    fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL),
  rm: (target) => fsp.rm(target, { force: true }),
  lstat: (target) => fsp.lstat(target),
});

// link() is atomic and fails with EEXIST if the name is taken; filesystems
// without hard links fall back to an exclusive copy.
async function publishExclusive(
  io: PublishFs,
  sourcePath: string,
  absDest: string,
): Promise<void> {
  const exists = () =>
    new LocalFileError("EEXIST", `"${path.basename(absDest)}" already exists`);
  try {
    await io.link(sourcePath, absDest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw exists();
    try {
      await io.copyFileExcl(sourcePath, absDest);
    } catch (copyError) {
      if ((copyError as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw exists();
      }
      throw copyError;
    }
  }
  await io.rm(sourcePath);
}

// rename() onto an existing file is not portable (it commonly fails on
// Windows), so move the old file aside, publish exclusively, then drop it.
async function replaceExisting(
  io: PublishFs,
  partialPath: string,
  absDest: string,
  transferId: string,
): Promise<void> {
  let current: fs.Stats;
  try {
    current = await io.lstat(absDest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      await publishExclusive(io, partialPath, absDest);
      return;
    }
    throw error;
  }
  if (current.isDirectory()) {
    throw new LocalFileError(
      "EISDIR",
      `"${path.basename(absDest)}" is a folder and cannot be replaced by a file`,
    );
  }

  const asidePath = `${absDest}.${transferToken(transferId)}.termix-replaced`;
  try {
    await io.rename(absDest, asidePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
      throw new LocalFileError(
        "EBUSY",
        `"${path.basename(absDest)}" is in use and could not be replaced`,
      );
    }
    throw error;
  }

  try {
    await publishExclusive(io, partialPath, absDest);
  } catch (error) {
    await io.rm(absDest).catch(() => {});
    await io.rename(asidePath, absDest).catch(() => {});
    throw error;
  }

  try {
    await io.rm(asidePath);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await io.rm(asidePath).catch(() => {});
  }
}

export async function publishDownload(
  partialPath: string,
  absDest: string,
  overwrite: boolean,
  transferId: string,
  io: PublishFs = defaultPublishFs,
): Promise<void> {
  if (overwrite) {
    await replaceExisting(io, partialPath, absDest, transferId);
    return;
  }
  await publishExclusive(io, partialPath, absDest);
}

// Bytes go to a transfer-unique temp sibling first and are published under the
// real name only on success, so a failed transfer never leaves a truncated file.
export async function openDownload(
  options: {
    rootPath: string;
    destPath: string;
    transferId: string;
    overwrite?: boolean;
  },
  io: PublishFs = defaultPublishFs,
): Promise<PluginLocalDownload> {
  const { rootPath, destPath, transferId } = options;
  if (!transferId || !destPath) throw new Error("Missing download parameters");

  const destination = await prepareDownloadPath(rootPath, destPath);
  const absDest = destination.path;
  if (activeDestinations.has(absDest)) {
    throw new LocalFileError(
      "EBUSY",
      `"${path.basename(absDest)}" is already being downloaded`,
    );
  }
  activeDestinations.add(absDest);

  const partialPath = `${path.join(destination.root, path.basename(absDest))}.${transferToken(
    transferId,
  )}.termix-part`;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeDestinations.delete(absDest);
  };

  try {
    if (options.overwrite !== true && (await pathExists(absDest))) {
      throw new LocalFileError(
        "EEXIST",
        `"${path.basename(absDest)}" already exists`,
      );
    }
    // "wx": the temp name is ours alone; refuse to reuse a stale one.
    const stream = fs.createWriteStream(partialPath, { flags: "wx" });
    // A write error must not crash the backend. publish() reports it.
    let streamError: Error | null = null;
    stream.on("error", (error) => {
      streamError = error;
    });

    return {
      path: absDest,
      stream,
      publish: async (publishOptions) => {
        try {
          if (streamError) throw streamError;
          await new Promise<void>((resolve, reject) => {
            if (stream.writableFinished) return resolve();
            stream.once("error", reject);
            stream.end(() => resolve());
          });
          if (streamError) throw streamError;
          await prepareDownloadPath(destination.root, absDest);
          await publishDownload(
            partialPath,
            absDest,
            (publishOptions?.overwrite ?? options.overwrite) === true,
            transferId,
            io,
          );
          return absDest;
        } catch (error) {
          await fsp.rm(partialPath, { force: true }).catch(() => {});
          throw error;
        } finally {
          release();
        }
      },
      abort: async () => {
        stream.destroy();
        await fsp.rm(partialPath, { force: true }).catch(() => {});
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
