/**
 * Returns the base path prefix for API and WebSocket URLs.
 * Uses Vite's import.meta.env.BASE_URL which is set by the `base` config.
 * Default: "" (no prefix). With VITE_BASE_PATH=/termix/: "/termix"
 */
export function getBasePath(): string {
  const base = import.meta.env.BASE_URL || "/";
  if (base === "./" || base === "/") return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}
