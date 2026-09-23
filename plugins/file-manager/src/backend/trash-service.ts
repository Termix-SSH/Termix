import crypto from "node:crypto";
import path from "node:path";
import type { SFTPWrapper, Stats } from "ssh2";

export interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  isDirectory: boolean;
  deletedAt: string;
  size: number;
}

type StoredTrashItem = TrashItem & { trashPath: string };

const TRASH_DIR = ".termix-trash";
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

function call<T>(
  run: (done: (error: Error | undefined, value: T) => void) => void,
) {
  return new Promise<T>((resolve, reject) => {
    run((error, value) => (error ? reject(error) : resolve(value)));
  });
}

function stat(sftp: SFTPWrapper, target: string) {
  return call<Stats>((done) => sftp.stat(target, done));
}

function lstat(sftp: SFTPWrapper, target: string) {
  return call<Stats>((done) => sftp.lstat(target, done));
}

function readdir(sftp: SFTPWrapper, target: string) {
  return call<import("ssh2").FileEntry[]>((done) => sftp.readdir(target, done));
}

function readFile(sftp: SFTPWrapper, target: string) {
  return call<Buffer>((done) => sftp.readFile(target, done));
}

function writeFile(sftp: SFTPWrapper, target: string, data: string) {
  return call<void>((done) => sftp.writeFile(target, data, done));
}

function rename(sftp: SFTPWrapper, from: string, to: string) {
  return call<void>((done) => sftp.rename(from, to, done));
}

function unlink(sftp: SFTPWrapper, target: string) {
  return call<void>((done) => sftp.unlink(target, done));
}

function mkdir(sftp: SFTPWrapper, target: string) {
  return call<void>((done) => sftp.mkdir(target, done));
}

function rmdir(sftp: SFTPWrapper, target: string) {
  return call<void>((done) => sftp.rmdir(target, done));
}

async function exists(sftp: SFTPWrapper, target: string) {
  try {
    await stat(sftp, target);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(sftp: SFTPWrapper, target: string) {
  const normalized = target.replace(/\\/g, "/");
  const root = normalized.startsWith("/") ? "/" : "";
  const parts = normalized.split("/").filter(Boolean);
  let current = root;
  for (const part of parts) {
    current =
      current === "/" ? `/${part}` : current ? `${current}/${part}` : part;
    if (await exists(sftp, current)) continue;
    await mkdir(sftp, current);
  }
}

async function removeTree(sftp: SFTPWrapper, target: string): Promise<void> {
  const targetStat = await lstat(sftp, target);
  if (!targetStat.isDirectory()) {
    await unlink(sftp, target);
    return;
  }
  for (const entry of await readdir(sftp, target)) {
    if (entry.filename === "." || entry.filename === "..") continue;
    await removeTree(sftp, path.posix.join(target, entry.filename));
  }
  await rmdir(sftp, target);
}

async function trashPaths(sftp: SFTPWrapper) {
  const home = await call<string>((done) => sftp.realpath(".", done));
  const root = path.posix.join(home.replace(/\\/g, "/"), TRASH_DIR);
  const files = path.posix.join(root, "files");
  const info = path.posix.join(root, "info");
  await ensureDirectory(sftp, files);
  await ensureDirectory(sftp, info);
  return { root, files, info };
}

export function isSafeTrashSource(itemPath: string, trashRoot: string) {
  const normalized = path.posix.normalize(itemPath.replace(/\\/g, "/"));
  const root = path.posix.normalize(trashRoot);
  return (
    normalized !== "." &&
    normalized !== "/" &&
    !/^[A-Za-z]:\/?$/.test(normalized) &&
    normalized !== root &&
    !normalized.startsWith(`${root}/`)
  );
}

function publicItem(item: StoredTrashItem): TrashItem {
  const { trashPath: _trashPath, ...result } = item;
  return result;
}

async function readStoredItem(
  sftp: SFTPWrapper,
  dirs: { root: string; files: string; info: string },
  id: string,
): Promise<StoredTrashItem> {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid trash item id");
  const parsed = JSON.parse(
    (await readFile(sftp, path.posix.join(dirs.info, `${id}.json`))).toString(
      "utf8",
    ),
  ) as StoredTrashItem;
  if (
    parsed.id !== id ||
    parsed.trashPath !== path.posix.join(dirs.files, id) ||
    !isSafeTrashSource(parsed.originalPath, dirs.root)
  ) {
    throw new Error("Invalid trash metadata");
  }
  return parsed;
}

export async function moveToTrash(
  sftp: SFTPWrapper,
  itemPath: string,
): Promise<TrashItem> {
  const dirs = await trashPaths(sftp);
  if (!isSafeTrashSource(itemPath, dirs.root)) {
    throw new Error("This path cannot be moved to trash");
  }
  const itemStat = await lstat(sftp, itemPath);
  const id = crypto.randomUUID();
  const trashPath = path.posix.join(dirs.files, id);
  const item: StoredTrashItem = {
    id,
    name: path.posix.basename(itemPath.replace(/\\/g, "/")),
    originalPath: itemPath,
    trashPath,
    isDirectory: itemStat.isDirectory(),
    deletedAt: new Date().toISOString(),
    size: itemStat.size,
  };

  await rename(sftp, itemPath, trashPath);
  try {
    await writeFile(
      sftp,
      path.posix.join(dirs.info, `${id}.json`),
      JSON.stringify(item),
    );
  } catch (error) {
    await rename(sftp, trashPath, itemPath).catch(() => {});
    throw error;
  }
  return publicItem(item);
}

export async function listTrash(
  sftp: SFTPWrapper,
  retentionDays: number,
): Promise<TrashItem[]> {
  const dirs = await trashPaths(sftp);
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const items: TrashItem[] = [];
  for (const entry of await readdir(sftp, dirs.info)) {
    if (!entry.filename.endsWith(".json")) continue;
    const id = entry.filename.slice(0, -5);
    try {
      const item = await readStoredItem(sftp, dirs, id);
      if (new Date(item.deletedAt).getTime() < cutoff) {
        if (await exists(sftp, item.trashPath))
          await removeTree(sftp, item.trashPath);
        await unlink(sftp, path.posix.join(dirs.info, entry.filename));
        continue;
      }
      if (await exists(sftp, item.trashPath)) items.push(publicItem(item));
      else await unlink(sftp, path.posix.join(dirs.info, entry.filename));
    } catch {
      // Ignore corrupt metadata without exposing arbitrary paths to deletion.
    }
  }
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function restoreTrashItem(sftp: SFTPWrapper, id: string) {
  const dirs = await trashPaths(sftp);
  const item = await readStoredItem(sftp, dirs, id);
  if (await exists(sftp, item.originalPath)) {
    throw new Error("A file already exists at the original path");
  }
  await rename(sftp, item.trashPath, item.originalPath);
  await unlink(sftp, path.posix.join(dirs.info, `${id}.json`));
  return publicItem(item);
}

export async function permanentlyDeleteTrashItem(
  sftp: SFTPWrapper,
  id: string,
) {
  const dirs = await trashPaths(sftp);
  const item = await readStoredItem(sftp, dirs, id);
  if (await exists(sftp, item.trashPath))
    await removeTree(sftp, item.trashPath);
  await unlink(sftp, path.posix.join(dirs.info, `${id}.json`));
}

export async function emptyTrash(sftp: SFTPWrapper) {
  const items = await listTrash(sftp, 365_000);
  for (const item of items) await permanentlyDeleteTrashItem(sftp, item.id);
  return items.length;
}
