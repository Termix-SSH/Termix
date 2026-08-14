import type { FileItem } from "@/types/index";
import { createKeyedRequestCache } from "./keyed-request-cache";

export interface FileContentResult {
  content: string;
  path: string;
  encoding?: "base64" | "utf8";
}

const MAX_PREFETCH_BYTES = 512 * 1024;
const cache = createKeyedRequestCache<FileContentResult>(30_000, 24);
const keyFor = (sessionId: string, path: string) => `${sessionId}\0${path}`;

export function getCachedFileContent(
  sessionId: string,
  path: string,
  loader: () => Promise<FileContentResult>,
  force = false,
): Promise<FileContentResult> {
  return cache.get(keyFor(sessionId, path), loader, { force });
}

export function invalidateCachedFileContent(
  sessionId: string,
  path: string,
): void {
  cache.invalidate(keyFor(sessionId, path));
}

export function shouldPrefetchFileContent(
  file: FileItem,
  networkMultiplier: number,
): boolean {
  return (
    file.type === "file" &&
    typeof file.size === "number" &&
    file.size <= MAX_PREFETCH_BYTES &&
    networkMultiplier <= 1
  );
}
