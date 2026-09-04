// Thin, typed access to the desktop app's local filesystem bridge
// (electron/local-files.cjs via preload.js). Everything here resolves to
// "unavailable" outside Electron so callers can feature-detect cheaply.

import type {
  LocalDirectoryListing,
  LocalFsHomeInfo,
  LocalFsResult,
  LocalWalkResult,
} from "@/types/electron";
import { isElectron } from "./electron";

export function isLocalFileBrowserAvailable(): boolean {
  if (!isElectron()) return false;
  const api = window.electronAPI;
  return !!api?.localFs && !!api?.localTransfer;
}

function requireLocalFs() {
  const api = window.electronAPI?.localFs;
  if (!api) {
    throw new Error("Local file access is only available in the desktop app");
  }
  return api;
}

function unwrap<T>(result: LocalFsResult<T>): T {
  if (!result || result.success !== true) {
    const message =
      result && "error" in result && result.error
        ? result.error
        : "Local file operation failed";
    const error = new Error(message) as Error & { code?: string };
    if (result && "code" in result) error.code = result.code;
    throw error;
  }
  return result;
}

export async function getLocalHome(): Promise<LocalFsHomeInfo> {
  return unwrap(await requireLocalFs().home());
}

export async function listLocalDirectory(
  dirPath: string,
): Promise<LocalDirectoryListing> {
  return unwrap(await requireLocalFs().list(dirPath));
}

export async function createLocalFolder(
  parentPath: string,
  name: string,
): Promise<string> {
  return unwrap(await requireLocalFs().mkdir(parentPath, name)).path;
}

export async function ensureLocalDirectory(dirPath: string): Promise<string> {
  return unwrap(await requireLocalFs().ensureDir(dirPath)).path;
}

export async function walkLocalPaths(
  paths: string[],
): Promise<LocalWalkResult> {
  return unwrap(await requireLocalFs().walk(paths));
}

export async function revealLocalPath(targetPath: string): Promise<void> {
  unwrap(await requireLocalFs().reveal(targetPath));
}

export async function openLocalPath(targetPath: string): Promise<void> {
  unwrap(await requireLocalFs().open(targetPath));
}
