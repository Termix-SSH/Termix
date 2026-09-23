#!/usr/bin/env node
/**
 * The shell knows no plugin by name.
 *
 * Fails when anything under src/ui (tests and locales aside) imports from
 * plugins/, or spells a plugin id or a view a plugin owns (a tab, panel or
 * dashboard card id from a manifest) as a string literal. What the shell
 * needs from a plugin comes through the registries instead.
 *
 * A few literals are data rather than knowledge of a plugin: host protocol
 * names that are columns on the host until Phase B moves them, and the
 * terminal's own websocket, which lives in core until the terminal moves.
 * Those are listed with a reason in scripts/shell-plugin-id-allowlist.json,
 * which fails too when an entry stops being needed, so it only shrinks.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const UI = path.join(ROOT, "src", "ui");
const ALLOWLIST = path.join(__dirname, "shell-plugin-id-allowlist.json");

function manifests() {
  const dir = path.join(ROOT, "plugins");
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, "manifest.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
}

function pluginNames() {
  const names = new Set();
  for (const manifest of manifests()) {
    names.add(manifest.id);
    const contributes = manifest.contributes ?? {};
    for (const list of [
      contributes.tabs,
      contributes.panels,
      contributes.dashboardCards,
    ]) {
      for (const view of list ?? []) names.add(view.id);
    }
  }
  return names;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests" || entry.name === "locales") continue;
      walk(full, out);
    } else if (/\.(tsx?|mjs|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scan() {
  const names = pluginNames();
  const found = {};
  const add = (file, what) => {
    const key = path.relative(ROOT, file).replaceAll("\\", "/");
    (found[key] ??= new Set()).add(what);
  };

  for (const file of walk(UI, [])) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
    )) {
      if (/(^|\/)plugins\//.test(match[1])) add(file, `import ${match[1]}`);
    }
    for (const match of source.matchAll(/["'`]([a-z][a-z0-9_-]*)["'`]/g)) {
      if (names.has(match[1])) add(file, match[1]);
    }
  }
  return Object.fromEntries(
    Object.entries(found).map(([file, set]) => [file, [...set].sort()]),
  );
}

function main() {
  const found = scan();
  if (process.argv.includes("--list")) {
    console.log(JSON.stringify(found, null, 2));
    return;
  }

  const allow = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")).files ?? {};
  const problems = [];

  for (const [file, literals] of Object.entries(found)) {
    const allowed = new Set(allow[file]?.literals ?? []);
    for (const literal of literals) {
      if (!allowed.has(literal)) problems.push(`${file}: ${literal}`);
    }
  }
  for (const [file, entry] of Object.entries(allow)) {
    for (const literal of entry.literals ?? []) {
      if (!found[file]?.includes(literal)) {
        problems.push(
          `${file}: allowlisted "${literal}" no longer appears; remove it`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      "The shell names plugins it should reach through a registry:",
    );
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
}

main();
