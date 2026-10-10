#!/usr/bin/env node
// Fails when core reads an env var that env.catalog.json does not list. The
// docs site builds its env var page from that file.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["src/backend", "electron"];
const PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /\benv\.([A-Z][A-Z0-9_]*)\b/g,
  /\benv\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /_ENV\s*=\s*["']([A-Z][A-Z0-9_]*)["']/g,
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "tests") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (
      /\.(ts|cjs|mjs|js)$/.test(entry.name) &&
      !/\.test\./.test(entry.name)
    )
      out.push(full);
  }
  return out;
}

function readNames(root = ROOT) {
  const found = new Map();
  for (const dir of DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const text = fs.readFileSync(file, "utf8");
      for (const pattern of PATTERNS) {
        for (const match of text.matchAll(pattern)) {
          if (!found.has(match[1]))
            found.set(match[1], path.relative(root, file));
        }
      }
    }
  }
  return found;
}

function main() {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(ROOT, "env.catalog.json"), "utf8"),
  );
  const listed = new Set(catalog.vars.map((v) => v.name));
  const problems = [];
  for (const v of catalog.vars) {
    if (!catalog.groups[v.group])
      problems.push(`${v.name}: unknown group "${v.group}"`);
    if (!v.description?.trim()) problems.push(`${v.name}: no description`);
  }
  for (const [name, file] of readNames()) {
    if (!listed.has(name))
      problems.push(
        `${name} is read in ${file} but missing from env.catalog.json`,
      );
  }
  if (problems.length) {
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`env catalog ok (${listed.size} vars)`);
}

if (require.main === module) main();
module.exports = { readNames, PATTERNS };
