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

export const IMAGE_FILENAME_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;

export function isImageFilename(filename: string): boolean {
  return IMAGE_FILENAME_PATTERN.test(filename);
}

export function isExpiredImage(
  modifiedAtMs: number,
  nowMs: number,
  ttlMs: number,
): boolean {
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
