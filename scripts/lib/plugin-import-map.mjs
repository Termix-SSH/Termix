/**
 * The modules the shell shares with plugin bundles, and the import map that
 * points plugin imports at them.
 *
 * One instance of React, i18next and the SDK has to exist across the shell
 * and every plugin, so plugin bundles leave these imports bare and the page's
 * import map resolves them to the shell's own copies. Used by the Vite plugin
 * that builds the map and by scripts/check-importmap-csp.cjs, which keeps the
 * nginx CSP hash in step with it.
 */

import crypto from "node:crypto";

/**
 * Third-party modules that must be one instance. Keep in step with the CLI's
 * FRONTEND_EXTERNALS. `cjs` modules need their named exports listed, since
 * `export *` drops them; `hasDefault` says an ES module has a default export.
 */
export const SHARED_VENDORS = [
  { specifier: "react", cjs: true },
  { specifier: "react-dom", cjs: true },
  { specifier: "react-dom/client", cjs: true },
  { specifier: "react/jsx-runtime", cjs: true },
  { specifier: "i18next", cjs: false, hasDefault: true },
  { specifier: "react-i18next", cjs: false, hasDefault: false },
  { specifier: "sonner", cjs: false, hasDefault: false },
];

export const SHARED_VENDOR_MODULES = SHARED_VENDORS.map(
  (vendor) => vendor.specifier,
);

/** SDK entries that are implemented by, or hold state shared with, core. */
export const SHARED_SDK_MODULES = [
  "@termix/plugin-sdk/frontend",
  "@termix/plugin-sdk/ui",
];

export function sharedModules() {
  return [...SHARED_VENDOR_MODULES, ...SHARED_SDK_MODULES];
}

/** A file-name-safe name for a shared module's shim. */
export function shimName(specifier) {
  return specifier
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Where a shared module's stable shim lands in the build output. */
export function shimPath(specifier) {
  return `shared/${shimName(specifier)}.js`;
}

/**
 * The import map text for a production build. Deterministic: sorted, compact,
 * and pointing at the unhashed shims, so it only changes when the list of
 * shared modules does. That keeps its CSP hash stable across builds.
 */
export function productionImportMap(specifiers) {
  const imports = {};
  for (const specifier of [...specifiers].sort()) {
    imports[specifier] = `./${shimPath(specifier)}`;
  }
  return JSON.stringify({ imports });
}

export function importMapCspHash(text) {
  return `'sha256-${crypto.createHash("sha256").update(text, "utf8").digest("base64")}'`;
}
