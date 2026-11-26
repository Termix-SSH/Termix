/**
 * Permissions Policy features delegated to plugin iframes.
 *
 * - `clipboard-write`: lets a frame copy to the clipboard after a user click.
 * - `local-network-access *`, `local-network *`, `loopback-network *`: plugin
 *   frames run with `sandbox="allow-scripts"` (opaque `null` origin), which
 *   never matches `'self'` or `'src'`. Without explicit wildcard delegation,
 *   Chrome 142+ Local Network Access blocks sandboxed frames from loading
 *   their own `/plugin-assets/` scripts when Termix is served on a LAN or
 *   loopback address. Network destinations remain restricted to the plugin's
 *   own routes by `pluginFrameCsp`.
 *
 * Firefox does not recognize these Permissions Policy tokens and logs a
 * console warning per frame when they are present.
 */
const CHROMIUM_FRAME_ALLOW =
  "clipboard-write; local-network-access *; local-network *; loopback-network *";

export function frameAllowFor(userAgent: string): string | undefined {
  return /firefox/i.test(userAgent) ? undefined : CHROMIUM_FRAME_ALLOW;
}

export const FRAME_ALLOW = frameAllowFor(
  typeof navigator !== "undefined" ? navigator.userAgent : "",
);
