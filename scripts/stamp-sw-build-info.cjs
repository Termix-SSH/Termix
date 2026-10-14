#!/usr/bin/env node
/** Stamp the cache version and static-build base path.
 * Docker keeps the base-path placeholder for entrypoint.sh to fill at startup.
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
  ...(process.env.TERMIX_RUNTIME_BASE_PATH === "true"
    ? []
    : [[BASE_PATH_PLACEHOLDER, basePath]]),
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
