/**
 * Counts the import-boundary debt between core and plugins, and fails when it
 * grows.
 *
 * The eslint fence marks these directions as warnings because there is nowhere
 * for them to go yet (see packages/plugin-sdk/ARCHITECTURE.md). A warning does
 * not fail a build, so this script holds the line instead: every offender is
 * listed in plugin-boundary-allowlist.json, a new one fails, and an entry that
 * stopped being an offender fails too, so the list shrinks as B steps land
 * rather than rotting. D1 empties it and the eslint rules become errors.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const allowlistPath = path.join(
  root,
  "scripts",
  "plugin-boundary-allowlist.json",
);
const norm = (p) => p.split(path.sep).join("/");

const DIRECTIONS = {
  // The shell importing plugin code. Empty since A7, and kept at zero: any
  // entry here fails, allowlisted or not.
  "ui-to-plugin": {
    roots: ["src/ui", "src/main.tsx"],
    skip: (rel) => rel.includes("/tests/"),
    pattern: /["'][^"']*\/plugins\/[a-z0-9-]+\//,
    mustBeEmpty: true,
  },
  // A bundled plugin frontend importing the shell's own modules through the
  // "@/" alias, which the CLI turns into @termix/legacy-core/* for the import
  // map. D1 empties this.
  "plugin-frontend-to-core": {
    roots: ["plugins"],
    only: (rel) => /^plugins\/[a-z0-9-]+\/src\/frontend\//.test(rel),
    pattern: /(?:from|import)\s*\(?\s*["']@\//,
  },
  // A plugin backend reaching core by relative path. D1 empties this.
  "plugin-to-core": {
    roots: ["plugins"],
    only: (rel) => /^plugins\/[a-z0-9-]+\/src\//.test(rel),
    pattern: /["'](?:\.\.\/)+src\/(backend|types)\//,
  },
  // One plugin importing another's source. Empty, and stays that way.
  "plugin-to-plugin": {
    roots: ["plugins"],
    only: (rel) => /^plugins\/[a-z0-9-]+\/src\//.test(rel),
    pattern: /["'](?:\.\.\/)+(?!src\/)[a-z0-9-]+\/src\/(backend|frontend)\//,
  },
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function filesUnder(base) {
  const full = path.join(root, base);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return [full];
  return walk(full);
}

function offendersFor(name, config) {
  const found = new Set();
  for (const base of config.roots) {
    for (const file of filesUnder(base)) {
      const rel = norm(path.relative(root, file));
      if (config.only && !config.only(rel)) continue;
      if (config.skip && config.skip(rel)) continue;
      const source = fs.readFileSync(file, "utf8");
      if (config.pattern.test(source)) found.add(rel);
    }
  }
  return [...found].sort();
}

const allowlist = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, "utf8"))
  : {};

if (process.argv.includes("--write")) {
  const next = {};
  for (const [name, config] of Object.entries(DIRECTIONS)) {
    next[name] = offendersFor(name, config);
  }
  fs.writeFileSync(allowlistPath, JSON.stringify(next, null, 2) + "\n");
  console.log("Wrote the allowlist from the current tree.");
  process.exit(0);
}

let failed = false;

for (const [name, config] of Object.entries(DIRECTIONS)) {
  const offenders = offendersFor(name, config);
  const allowed = new Set(allowlist[name] ?? []);

  const added = config.mustBeEmpty
    ? offenders
    : offenders.filter((file) => !allowed.has(file));
  const stale = [...allowed].filter((file) => !offenders.includes(file));

  if (added.length > 0) {
    failed = true;
    console.error(`\n${name}: ${added.length} new violation(s):`);
    for (const file of added) console.error(`  ${file}`);
  }

  if (stale.length > 0) {
    failed = true;
    console.error(
      `\n${name}: ${stale.length} allowlist entry(ies) no longer violate. Remove them:`,
    );
    for (const file of stale) console.error(`  ${file}`);
  }

  if (added.length === 0 && stale.length === 0) {
    console.log(`${name}: ${offenders.length} remaining (allowlisted)`);
  }
}

if (failed) {
  console.error(
    "\nRun `node scripts/check-plugin-boundaries.cjs --write` if the change is intentional.",
  );
  process.exit(1);
}
