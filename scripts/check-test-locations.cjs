#!/usr/bin/env node
/**
 * Tests mirror the source tree in their own directories and never sit next
 * to the code they test. A *.test.ts(x) file may only live under
 * src/backend/tests/, src/ui/tests/, scripts/ or plugins/<id>/tests/.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "release",
  "coverage",
  ".vite",
  ".turbo",
]);
const TEST_FILE = /\.test\.tsx?$/;
const ALLOWED = [
  /^src\/backend\/tests\//,
  /^src\/ui\/tests\//,
  /^scripts\//,
  /^plugins\/[^/]+\/tests\//,
];

function walk(dir, root, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, out);
    else if (TEST_FILE.test(entry.name)) {
      out.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  }
  return out;
}

/** Test files outside the directories tests belong in. */
function misplaced(root = ROOT) {
  return walk(root, root, [])
    .filter((file) => !ALLOWED.some((pattern) => pattern.test(file)))
    .sort();
}

function main() {
  const found = misplaced();
  if (found.length === 0) return;
  console.error(
    "Tests belong in src/backend/tests/, src/ui/tests/, scripts/ or plugins/<id>/tests/, mirroring the source:",
  );
  for (const file of found) console.error(`  ${file}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { misplaced };
