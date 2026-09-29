#!/usr/bin/env node
/**
 * Core knows no plugin by name.
 *
 * Fails when anything under src/ imports from plugins/, or spells a plugin id:
 * a bare literal ("docker"), a plugin route ("/plugin-api/docker/..."), or an
 * action, slot or permission id that starts with one ("docker.open"). The
 * shell (src/ui) also may not spell a view a plugin owns (a tab, panel or
 * dashboard card id from a manifest). What core needs from a plugin comes
 * through the registries instead. Regex literals are read too, so
 * /^\/plugin-api\/docker/ counts the same as "/plugin-api/docker".
 *
 * Tests and locales are exempt, and so is src/backend/upgrade/: the one-time
 * 2.8 to 2.9 data moves have to name the plugin each piece of data moves to,
 * the same way LEGACY_TABLE_OWNERS in the SDK names the plugin that adopts
 * each legacy table.
 *
 * One plugin id is also an SSH term: "totp" is the one-time-code prompt kind
 * in keyboard-interactive auth, which the connect pipeline in
 * src/backend/hosts/connect/ classifies. It is not the login plugin.
 */

const fs = require("node:fs");
const path = require("node:path");

const EXEMPT_DIRS = new Set(["tests", "locales"]);
const SSH_TERMS = new Set(["totp"]);

function paths(root) {
  const src = path.join(root, "src");
  return {
    root,
    src,
    ui: path.join(src, "ui"),
    plugins: path.join(root, "plugins"),
    exempt: [path.join(src, "backend", "upgrade")],
    sshConnect: path.join(src, "backend", "hosts", "connect"),
  };
}

function manifests(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, "manifest.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
}

function names(pluginsDir) {
  const ids = new Set();
  const views = new Set();
  for (const manifest of manifests(pluginsDir)) {
    ids.add(manifest.id);
    const contributes = manifest.contributes ?? {};
    for (const list of [
      contributes.tabs,
      contributes.panels,
      contributes.dashboardCards,
    ]) {
      for (const view of list ?? []) views.add(view.id);
    }
  }
  return { ids, views };
}

function walk(dir, exempt, out) {
  if (exempt.includes(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXEMPT_DIRS.has(entry.name)) continue;
      walk(full, exempt, out);
    } else if (/\.(tsx?|mjs|cjs|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every string literal in a file, template literals included. */
function literals(source) {
  const out = [];
  const pattern =
    /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  for (const match of source.matchAll(pattern)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

/**
 * Every regex literal in a file, with escaped slashes undone, so a pattern
 * reads the way the path it matches does.
 */
function regexLiterals(source) {
  const out = [];
  const pattern =
    /(^|[=(,:[!&|?{};]|\breturn)\s*\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+)\/[dgimsuyv]*/gm;
  for (const match of source.matchAll(pattern)) {
    const body = match[2];
    // A comment, not a pattern.
    if (body.startsWith("/") || body.startsWith("*")) continue;
    out.push(body.replace(/\\(.)/g, "$1"));
  }
  return out;
}

function scan(root = path.resolve(__dirname, "..")) {
  const { src, ui, plugins, exempt, sshConnect } = paths(root);
  const { ids, views } = names(plugins);
  const found = {};
  const add = (file, what) => {
    const key = path.relative(root, file).replaceAll("\\", "/");
    (found[key] ??= new Set()).add(what);
  };

  for (const file of walk(src, exempt, [])) {
    const source = fs.readFileSync(file, "utf8");
    const inShell = file.startsWith(ui + path.sep);
    const inConnect = file.startsWith(sshConnect + path.sep);
    for (const match of source.matchAll(
      /(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
    )) {
      const target = match[1].startsWith(".")
        ? path.resolve(path.dirname(file), match[1])
        : "";
      if (target.startsWith(plugins + path.sep)) {
        add(file, `import ${match[1]}`);
      }
    }
    for (const text of literals(source)) {
      const sshTerm = inConnect && SSH_TERMS.has(text);
      if ((ids.has(text) && !sshTerm) || (inShell && views.has(text))) {
        add(file, text);
      }
      for (const route of text.matchAll(
        /\/plugin-(?:api|ws|assets)\/([a-z0-9-]+)/g,
      )) {
        if (ids.has(route[1])) add(file, route[0]);
      }
      const prefix = /^([a-z][a-z0-9-]*)\.[a-zA-Z]/.exec(text);
      if (prefix && ids.has(prefix[1])) add(file, text);
    }
    for (const pattern of regexLiterals(source)) {
      for (const route of pattern.matchAll(
        /\/plugin-(?:api|ws|assets)\/([a-z0-9-]+)/g,
      )) {
        if (ids.has(route[1])) add(file, `/${pattern}/`);
      }
      const sshTerm = inConnect && SSH_TERMS.has(pattern);
      if (ids.has(pattern.replace(/^\^|\$$/g, "")) && !sshTerm) {
        add(file, `/${pattern}/`);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(found).map(([file, set]) => [file, [...set].sort()]),
  );
}

function main() {
  const found = scan();
  const entries = Object.entries(found);
  if (process.argv.includes("--list")) {
    console.log(JSON.stringify(found, null, 2));
    return;
  }
  if (entries.length > 0) {
    console.error("Core names plugins it should reach through a registry:");
    for (const [file, list] of entries) {
      console.error(`  ${file}: ${list.join(", ")}`);
    }
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { scan, regexLiterals };
