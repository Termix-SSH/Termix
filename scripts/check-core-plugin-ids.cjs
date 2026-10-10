#!/usr/bin/env node
/**
 * Core knows no plugin by name.
 *
 * Fails when anything under src/ spells a plugin id: a bare literal
 * ("docker"), a plugin route ("/plugin-api/docker/..."), or an action, slot
 * or permission id that starts with one ("docker.open"). What core needs from
 * a plugin comes through the registries instead. Regex literals are read too,
 * so /^\/plugin-api\/docker/ counts the same as "/plugin-api/docker".
 *
 * Plugins live in their own repos, so the ids are the official ones below
 * plus anything in docker/bundled-plugins.json. electron/ and vite.config.ts
 * are read as well.
 *
 * src/backend/tests, src/ui/tests and src/ui/locales are exempt, and so is
 * src/backend/upgrade/: the one-time
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

const SSH_TERMS = new Set(["totp"]);

const OFFICIAL_IDS = [
  "acme-ssl",
  "ai",
  "alerts",
  "automations",
  "docker",
  "file-manager",
  "fleets",
  "homepage",
  "host-metrics",
  "ldap",
  "network-topology",
  "opkssh",
  "proxmox",
  "remote-desktop",
  "secret-sources",
  "serial",
  "session-recording",
  "session-sharing",
  "snippets",
  "ssh-terminal",
  "sso",
  "step-ca",
  "tailscale",
  "telemetry",
  "termix-identity",
  "tmux-monitor",
  "totp",
  "tunnels",
  "vault",
  "wake-on-lan",
  "warpgate",
  "web-endpoint",
  "webauthn",
  "workspaces",
];

function paths(root) {
  const src = path.join(root, "src");
  return {
    root,
    src,
    bundled: path.join(root, "docker", "bundled-plugins.json"),
    extra: [path.join(root, "electron"), path.join(root, "vite.config.ts")],
    exempt: [
      path.join(src, "backend", "upgrade"),
      path.join(src, "backend", "tests"),
      path.join(src, "ui", "tests"),
      path.join(src, "ui", "locales"),
    ],
    sshConnect: path.join(src, "backend", "hosts", "connect"),
  };
}

function pluginIds(bundledFile) {
  const ids = new Set(OFFICIAL_IDS);
  if (bundledFile && fs.existsSync(bundledFile)) {
    for (const entry of JSON.parse(fs.readFileSync(bundledFile, "utf8"))
      .plugins ?? []) {
      if (typeof entry?.id === "string") ids.add(entry.id);
    }
  }
  return ids;
}

function walk(dir, exempt, out) {
  if (exempt.includes(dir) || !fs.existsSync(dir)) return out;
  if (fs.statSync(dir).isFile()) {
    out.push(dir);
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
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
  const { src, bundled, extra, exempt, sshConnect } = paths(root);
  const ids = pluginIds(bundled);
  const found = {};
  const add = (file, what) => {
    const key = path.relative(root, file).replaceAll("\\", "/");
    (found[key] ??= new Set()).add(what);
  };

  const files = walk(src, exempt, []);
  for (const target of extra) walk(target, exempt, files);
  for (const file of files) {
    // A line marked "plugin-id-ok" names a plugin on purpose, such as a key
    // an older release stored; the marker has to say why.
    const source = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/plugin-id-ok: \S/.test(line))
      .join("\n");
    const inConnect = file.startsWith(sshConnect + path.sep);
    for (const text of literals(source)) {
      const sshTerm = inConnect && SSH_TERMS.has(text);
      if (ids.has(text) && !sshTerm) add(file, text);
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
