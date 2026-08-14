import type { FileItem } from "@/types/index";
import { createKeyedRequestCache } from "./keyed-request-cache";

export interface FileListResult {
  files: FileItem[];
  path: string;
}

const cache = createKeyedRequestCache<FileListResult>(5_000, 150);

const keyFor = (sessionId: string, path: string) => `${sessionId}\0${path}`;

export function getCachedFileList(
  sessionId: string,
  path: string,
  loader: () => Promise<FileListResult>,
  force = false,
): Promise<FileListResult> {
  return cache.get(keyFor(sessionId, path), loader, { force });
}

export function peekCachedFileList(
  sessionId: string,
  path: string,
  maxAgeMs = 30_000,
): FileListResult | null {
  return cache.peek(keyFor(sessionId, path), maxAgeMs);
}

export function invalidateCachedFileList(
  sessionId: string,
  path: string,
): void {
  cache.invalidate(keyFor(sessionId, path));
}
