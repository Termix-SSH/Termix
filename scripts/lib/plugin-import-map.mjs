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
import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_CORE_PREFIX,
  findLegacyCoreImports,
} from "../../packages/plugin-sdk/cli/lib/legacy-core-specifier.mjs";

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

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        walk(full, out);
      }
    } else if (/\.(tsx?|mjs|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Legacy core modules imported by any bundled plugin's frontend. */
export function scanLegacyCoreModules(repoRoot) {
  const found = new Set();
  const pluginsDir = path.join(repoRoot, "plugins");
  let plugins = [];
  try {
    plugins = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const plugin of plugins) {
    if (!plugin.isDirectory()) continue;
    const files = walk(
      path.join(pluginsDir, plugin.name, "src", "frontend"),
      [],
    );
    for (const file of files) {
      for (const specifier of findLegacyCoreImports(
        fs.readFileSync(file, "utf8"),
      )) {
        found.add(specifier);
      }
    }
  }
  return [...found].sort();
}

export function sharedModules(repoRoot) {
  return [
    ...SHARED_VENDOR_MODULES,
    ...SHARED_SDK_MODULES,
    ...scanLegacyCoreModules(repoRoot),
  ];
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

/** Absolute source file behind a legacy core specifier, or null. */
export function resolveLegacyCoreFile(repoRoot, specifier) {
  if (!specifier.startsWith(LEGACY_CORE_PREFIX)) return null;
  const rest = specifier.slice(LEGACY_CORE_PREFIX.length);
  const base = rest.startsWith("types")
    ? path.join(repoRoot, "src", rest)
    : path.join(repoRoot, "src", "ui", rest.slice("ui/".length));
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}
