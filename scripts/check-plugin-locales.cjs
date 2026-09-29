#!/usr/bin/env node
/**
 * A plugin's strings live in its own locales/en.json.
 *
 * A plugin's i18next namespace falls back to core's, so a plugin can use
 * `common.*` without copying it. Any other key a plugin uses has to be in the
 * plugin's own en.json: one that only resolves through the fallback breaks
 * the moment core renames or drops it, and core cannot tell it is in use.
 *
 * Reads t("...") calls and i18n key props (titleKey, labelKey and the rest)
 * in plugins/<id>/src, and the *Key values in plugins/<id>/manifest.json.
 * A key with a namespace ("docker:hosts.x") is checked against that plugin.
 *
 * --list prints what is missing per plugin, with whether core has the key.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PLUGINS = path.join(ROOT, "plugins");
const CORE_LOCALE = path.join(ROOT, "src", "ui", "locales", "en.json");

const SHARED_PREFIXES = ["common."];
const KEY = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const KEY_PROPS = new Set([
  "titleKey",
  "labelKey",
  "descriptionKey",
  "noHostMessageKey",
  "paletteKey",
  "hintKey",
  "messageKey",
  "placeholderKey",
  "tooltipKey",
  "i18nKey",
  "enableLabelKey",
  "enableDescriptionKey",
  "consequenceKey",
  "groupKey",
  "emptyKey",
  "nameKey",
]);
const PLURAL_SUFFIXES = [
  "_zero",
  "_one",
  "_two",
  "_few",
  "_many",
  "_other",
  "_plural",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Whether a dotted key resolves in a locale tree, the way i18next finds it:
 * a segment may itself hold dots ("services.use"), and a last segment may be
 * a plural form.
 */
function hasKey(tree, key) {
  const find = (node, parts) => {
    if (parts.length === 0) return node !== undefined;
    if (!node || typeof node !== "object") return false;
    for (let end = parts.length; end >= 1; end--) {
      const name = parts.slice(0, end).join(".");
      if (name in node && find(node[name], parts.slice(end))) return true;
      if (
        end === parts.length &&
        PLURAL_SUFFIXES.some((suffix) => `${name}${suffix}` in node)
      ) {
        return true;
      }
    }
    return false;
  };
  return find(tree, key.split("."));
}

function isShared(key) {
  return SHARED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Drops comments, so an example in one is not read as a call. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every literal i18n key a source file uses. A prefix a key is built from at
 * run time ends in ".*".
 */
function keysInSource(text) {
  const source = stripComments(text);
  const keys = new Set();
  for (const match of source.matchAll(
    /\bt\(\s*(["'])((?:(?!\1)[^\\\n$`])+)\1/g,
  )) {
    keys.add(match[2]);
  }
  for (const match of source.matchAll(
    /\b([A-Za-z]+Key)\s*[:=]\s*\{?\s*(["'])((?:(?!\2)[^\\\n])+)\2/g,
  )) {
    if (KEY_PROPS.has(match[1])) keys.add(match[3]);
  }
  // A key built at run time: `hosts.sharing.levels.${level}.label` needs the
  // whole hosts.sharing.levels subtree. A one-segment prefix says too little
  // to check.
  for (const match of source.matchAll(
    /\bt\(\s*`((?:[A-Za-z0-9_-]+\.){2,})\$\{/g,
  )) {
    keys.add(`${match[1]}*`);
  }
  return [...keys].filter((key) =>
    KEY.test(key.replace(/^[a-z0-9-]+:/, "").replace(/\.\*$/, "")),
  );
}

function keysInManifest(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) keysInManifest(item, out);
  } else if (value && typeof value === "object") {
    for (const [name, child] of Object.entries(value)) {
      if (KEY_PROPS.has(name) && typeof child === "string") out.add(child);
      else keysInManifest(child, out);
    }
  }
  return out;
}

function pluginIds(pluginsDir) {
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(pluginsDir, id, "manifest.json")))
    .sort();
}

/**
 * Keys each plugin uses but does not define, other than the shared ones.
 * Returns { [pluginId]: [{ key, file, inCore }] }.
 */
function scan({ pluginsDir = PLUGINS, coreLocale = CORE_LOCALE } = {}) {
  const core = fs.existsSync(coreLocale) ? readJson(coreLocale) : {};
  const ids = pluginIds(pluginsDir);
  const locales = new Map(
    ids.map((id) => {
      const file = path.join(pluginsDir, id, "locales", "en.json");
      return [id, fs.existsSync(file) ? readJson(file) : {}];
    }),
  );

  const missing = {};
  const check = (owner, rawKey, file) => {
    const colon = rawKey.indexOf(":");
    const namespace = colon > 0 ? rawKey.slice(0, colon) : owner;
    const key = colon > 0 ? rawKey.slice(colon + 1) : rawKey;
    if (isShared(key)) return;
    const tree = locales.get(namespace);
    const lookup = key.endsWith(".*") ? key.slice(0, -2) : key;
    if (tree && hasKey(tree, lookup)) return;
    const inCore = hasKey(core, lookup);
    // A bare word that is nowhere is a local helper named t, not a string.
    if (!key.includes(".") && !inCore) return;
    const list = (missing[owner] ??= []);
    if (!list.some((entry) => entry.key === rawKey)) {
      list.push({
        key: rawKey,
        file: path.relative(ROOT, file).replaceAll("\\", "/"),
        inCore,
      });
    }
  };

  for (const id of ids) {
    const manifestFile = path.join(pluginsDir, id, "manifest.json");
    for (const key of keysInManifest(readJson(manifestFile))) {
      if (KEY.test(key.replace(/^[a-z0-9-]+:/, ""))) {
        check(id, key, manifestFile);
      }
    }
    for (const file of walk(path.join(pluginsDir, id, "src"))) {
      for (const key of keysInSource(fs.readFileSync(file, "utf8"))) {
        check(id, key, file);
      }
    }
  }
  for (const list of Object.values(missing)) {
    list.sort((a, b) => a.key.localeCompare(b.key));
  }
  return missing;
}

function main() {
  const missing = scan();
  if (process.argv.includes("--list")) {
    console.log(JSON.stringify(missing, null, 2));
    return;
  }
  const entries = Object.entries(missing);
  if (entries.length === 0) return;
  console.error(
    "Plugins use i18n keys their own locales/en.json does not define:",
  );
  for (const [id, list] of entries) {
    for (const { key, file } of list) {
      console.error(`  ${id}: ${key} (${file})`);
    }
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = { scan, keysInSource, hasKey };
