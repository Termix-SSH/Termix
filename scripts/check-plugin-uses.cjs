#!/usr/bin/env node
/**
 * A plugin that calls another plugin's action, fills its slot or extends its
 * extension point has to say so in manifest.json contributes.uses. Nothing
 * else records that coupling: the ids are plain strings, so without it a
 * plugin moved to its own repo silently loses a feature when the other one is
 * renamed, and nobody can tell what depends on what.
 *
 * Owners are read from the code: a plugin owns the actions it registers, the
 * slots it renders (ActionSlot/ComponentSlot/useSlotContributions/
 * declareActionSlot) and the extension points it reads (useExtensions). An id
 * nobody owns is core's and needs no declaration.
 *
 * --list prints what each plugin uses from which owner.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PLUGINS = path.join(ROOT, "plugins");

// Each pattern captures a string literal or a constant's name; constants are
// resolved against the plugin's own `const NAME = "id"` declarations.
const ID = String.raw`(?:"([^"]+)"|([A-Z][A-Z0-9_]*))`;
const OWNS = [
  new RegExp(String.raw`registerAction\(\s*${ID}`, "g"),
  new RegExp(String.raw`declareActionSlot\(\s*\{\s*id:\s*${ID}`, "g"),
  new RegExp(
    String.raw`<(?:ActionSlot|ComponentSlot)[^>]*?slotId=\{?${ID}`,
    "g",
  ),
  new RegExp(String.raw`useSlotContributions\(\s*${ID}`, "g"),
  new RegExp(String.raw`useExtensions(?:<[^>]*>)?\(\s*${ID}`, "g"),
  new RegExp(String.raw`getExtension\(\s*${ID}`, "g"),
];
const USES = [
  new RegExp(String.raw`invokeAction\(\s*${ID}`, "g"),
  new RegExp(String.raw`registerSlotContribution\(\s*${ID}`, "g"),
  new RegExp(String.raw`registerExtension\(\s*${ID}`, "g"),
  new RegExp(
    String.raw`<(?:ActionSlot|ComponentSlot)[^>]*?slotId=\{?${ID}`,
    "g",
  ),
  new RegExp(String.raw`useSlotContributions\(\s*${ID}`, "g"),
];

function sourceOf(dir) {
  let text = "";
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        text += fs.readFileSync(file, "utf8");
      }
    }
  };
  walk(path.join(dir, "src"));
  return text;
}

function constants(text) {
  const map = new Map();
  for (const match of text.matchAll(
    /const ([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"/g,
  )) {
    map.set(match[1], match[2]);
  }
  return map;
}

function matches(patterns, text) {
  const names = constants(text);
  const found = new Set();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const id = match[1] ?? names.get(match[2]);
      if (id) found.add(id);
    }
  }
  return found;
}

function collect(pluginsDir = PLUGINS) {
  const plugins = fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) =>
      fs.existsSync(path.join(pluginsDir, entry.name, "manifest.json")),
    )
    .map((entry) => {
      const dir = path.join(pluginsDir, entry.name);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
      );
      const source = sourceOf(dir);
      return {
        id: manifest.id,
        declared: new Set(manifest.contributes?.uses ?? []),
        owns: matches(OWNS, source),
        uses: matches(USES, source),
      };
    });

  const owner = new Map();
  for (const plugin of plugins) {
    for (const id of plugin.owns) if (!owner.has(id)) owner.set(id, plugin.id);
  }

  const problems = [];
  const usage = {};
  for (const plugin of plugins) {
    for (const id of plugin.uses) {
      const by = owner.get(id);
      if (!by || by === plugin.id || plugin.owns.has(id)) continue;
      (usage[plugin.id] ??= []).push(`${id} (${by})`);
      if (!plugin.declared.has(id)) {
        problems.push(
          `${plugin.id} uses "${id}" from the ${by} plugin; add it to contributes.uses in plugins/${plugin.id}/manifest.json`,
        );
      }
    }
    for (const id of plugin.declared) {
      if (!plugin.uses.has(id)) {
        problems.push(
          `${plugin.id} declares "${id}" in contributes.uses but never uses it`,
        );
      }
    }
  }
  return { problems, usage, owner };
}

function main() {
  const { problems, usage } = collect();
  if (process.argv.includes("--list")) {
    console.log(JSON.stringify(usage, null, 2));
    return;
  }
  if (problems.length === 0) return;
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

if (require.main === module) main();

/** Every action, slot and extension point id a plugin owns, by owner. */
function owners(pluginsDir = PLUGINS) {
  return collect(pluginsDir).owner;
}

module.exports = { collect, owners };
