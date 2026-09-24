/**
 * Host-provided packages.
 *
 * These ship with the Termix server and are never bundled into a plugin:
 * bundling them would give each plugin its own copy of express or React, and
 * a second ssh2 would mean a second set of native bindings. A plugin may
 * depend on anything outside these lists, and that does get bundled.
 *
 * Node builtins are external automatically through platform: "node".
 */

export const BACKEND_EXTERNALS = [
  "@termix/plugin-sdk",
  "@termix/plugin-sdk/*",
  "express",
  "ssh2",
  "ws",
  "multer",
  "cookie-parser",
  "axios",
  "jszip",
  "guacamole-lite",
  "@anthropic-ai/sdk",
  "drizzle-orm",
  "drizzle-orm/*",
  // Native image processing, loaded on first use by the terminal's image upload.
  "sharp",
];

/**
 * Resolved by the page's import map to the shell's own copies, because these
 * must be one instance: React, i18next, the toast store, and the SDK entries
 * that share state with core. Anything else a plugin imports is bundled.
 */
export const FRONTEND_EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
  "i18next",
  "react-i18next",
  "sonner",
  "@termix/plugin-sdk/frontend",
  "@termix/plugin-sdk/ui",
  // Legacy: the shell's own modules, see legacy-core-imports.mjs. D1 removes.
  "@termix/legacy-core/*",
];
