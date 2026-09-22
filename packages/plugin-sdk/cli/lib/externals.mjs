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
];

export const FRONTEND_EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
  "@termix/plugin-sdk",
  "@termix/plugin-sdk/*",
  "i18next",
  "react-i18next",
  // Core-provided UI libraries. A7 serves these through the SDK ui entry.
  "lucide-react",
  "sonner",
  "axios",
  "cytoscape",
  "react-cytoscapejs",
  "guacamole-common-js",
  "react-xtermjs",
  "@xterm/*",
  // Legacy: the shell's own modules, still reached by alias. A7 removes.
  "@/*",
];
