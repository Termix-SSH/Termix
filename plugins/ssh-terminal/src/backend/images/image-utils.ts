// Accepted decoded input formats; uploads are normalized to PNG by the route.
export const IMAGE_FORMAT_EXTENSIONS: Record<string, string> = {
  avif: "avif",
  gif: "gif",
  heif: "heif",
  jpeg: "jpg",
  jp2: "jp2",
  jxl: "jxl",
  png: "png",
  tiff: "tiff",
  webp: "webp",
};

export function imageExtensionForFormat(
  format: string | undefined,
): string | undefined {
  return format ? IMAGE_FORMAT_EXTENSIONS[format] : undefined;
}

export const MAX_NORMALIZED_IMAGE_BYTES = 10 * 1024 * 1024;

export function exceedsNormalizedImageSize(
  byteLength: number,
  maxBytes = MAX_NORMALIZED_IMAGE_BYTES,
): boolean {
  return byteLength > maxBytes;
}

export function createConcurrencyLimiter(
  limit: number,
  maxQueued = Number.POSITIVE_INFINITY,
): {
  acquire: () => Promise<() => void>;
  readonly active: number;
  readonly queued: number;
} {
  const max = Math.max(1, Math.floor(limit));
  const queueLimit = Math.max(0, Math.floor(maxQueued));
  let active = 0;
  const waiters: Array<() => void> = [];

  const startNext = () => {
    if (active >= max || waiters.length === 0) return;
    active += 1;
    waiters.shift()!();
  };

  return {
    acquire: () =>
      new Promise<() => void>((resolve, reject) => {
        if (active >= max && waiters.length >= queueLimit) {
          reject(new Error("Concurrency admission queue is full"));
          return;
        }
        waiters.push(() => {
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active -= 1;
            startNext();
          });
        });
        startNext();
      }),
    get active() {
      return active;
    },
    get queued() {
      return waiters.length;
    },
  };
}

export const IMAGE_FILENAME_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;

export function isImageFilename(filename: string): boolean {
  return IMAGE_FILENAME_PATTERN.test(filename);
}

export function isExpiredImage(
  modifiedAtMs: number,
  nowMs: number,
  ttlMs: number,
): boolean {
  if (ttlMs <= 0) return false;
  return nowMs - modifiedAtMs > ttlMs;
}

export function exceedsImageStorageLimit(
  fileCount: number,
  totalBytes: number,
  incomingBytes: number,
  maxFileCount: number,
  maxStorageBytes: number,
): boolean {
  return (
    fileCount >= maxFileCount || totalBytes + incomingBytes > maxStorageBytes
  );
}
