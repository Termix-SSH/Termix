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
