const NO_STORE =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";

/** Cache-Control for a file of the built frontend, by its path in dist. */
export function staticCacheControl(relativePath: string): string | null {
  if (relativePath.startsWith("assets/")) {
    return "public, max-age=31536000, immutable";
  }
  // The import map points at these unhashed shims, so an old copy would load
  // a previous build's SDK after an update.
  if (relativePath.startsWith("shared/")) return "no-cache";
  if (
    relativePath === "index.html" ||
    relativePath === "sw.js" ||
    relativePath === "manifest.json"
  ) {
    return NO_STORE;
  }
  return null;
}
