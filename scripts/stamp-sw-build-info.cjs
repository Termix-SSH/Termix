#!/usr/bin/env node
/**
 * Rewrites the build-time placeholders in dist/sw.js:
 *
 *   __TERMIX_CACHE_VERSION__ -> the package.json version (dots become dashes)
 *   __TERMIX_SW_BASE_PATH__  -> the effective base path the build used
 *
 * vite copies public/ verbatim and never transforms it, so both placeholders
 * reach dist/sw.js untouched unless something rewrites them here.
 *
 * Why both matter:
 *
 * - BASE_PATH unreplaced makes the worker request "__TERMIX_SW_BASE_PATH__/favicon.ico",
 *   its install promise rejects, and it never activates.
 * - CACHE_NAME unchanged across releases means a worker that *did* activate on
 *   an older build keeps serving its old cache forever, because the activate
 *   handler only deletes caches whose name differs from its own CACHE_NAME.
 *
 * Run as part of `build` right after `vite build`, before patch-sw-base-path
 * (this script only stamps the version; that one owns the base path).
 *
 * The base path mirrors vite.config.ts: VITE_BASE_PATH when set, otherwise
 * "./" (the same root-relative default the app bundle uses).
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SW_PATH = path.join(ROOT, "dist", "sw.js");

const VERSION_PLACEHOLDER = "__TERMIX_CACHE_VERSION__";
const BASE_PATH_PLACEHOLDER = "__TERMIX_SW_BASE_PATH__";

const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
);
const cacheVersion = String(pkg.version || "0.0.0").replace(/\./g, "-");

const rawBasePath = process.env.VITE_BASE_PATH || "./";
// "./" is what vite emits for a root deployment; cache URLs stay root-relative.
const basePath =
  rawBasePath === "./"
    ? ""
    : `/${rawBasePath.replace(/^\/+/, "").replace(/\/+$/, "")}`;

if (!fs.existsSync(SW_PATH)) {
  console.error(`[stamp-sw] dist/sw.js not found - run vite build first`);
  process.exit(1);
}

let sw = fs.readFileSync(SW_PATH, "utf8");
const rel = path.relative(ROOT, SW_PATH);
const replacements = [
  [VERSION_PLACEHOLDER, cacheVersion],
  [BASE_PATH_PLACEHOLDER, basePath],
];

let changed = false;
for (const [placeholder, value] of replacements) {
  if (sw.includes(placeholder)) {
    sw = sw.split(placeholder).join(value);
    changed = true;
    console.log(
      `[stamp-sw] ${rel}: ${placeholder} -> ${JSON.stringify(value)}`,
    );
  }
}

if (changed) {
  fs.writeFileSync(SW_PATH, sw);
}
