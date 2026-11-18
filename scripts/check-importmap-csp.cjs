#!/usr/bin/env node
/**
 * Keeps the nginx security headers in step with the backend.
 *
 * nginx serves the frontend files itself and the backend serves everything
 * else, so both must send the same headers. The values come from
 * src/backend/http/security-headers.ts. The app CSP allows the inline
 * <script type="importmap"> by its hash; the map text is deterministic (see
 * scripts/lib/plugin-import-map.mjs), so the hash only changes when the list
 * of shared modules does.
 *
 * Every location that serves files from /app/html gets the full header set.
 * Proxied locations get none: the backend adds them, and nginx headers there
 * would be sent twice.
 *
 *   node scripts/check-importmap-csp.cjs          check
 *   node scripts/check-importmap-csp.cjs --write  update the configs
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONFIGS = [
  { file: "docker/nginx.conf", https: false },
  { file: "docker/nginx-https.conf", https: true },
];

// Headers this script owns. Cache-Control and others are left alone.
const OWNED = [
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "strict-transport-security",
];

function headerName(line) {
  const match = /^\s*add_header\s+([A-Za-z-]+)\s/.exec(line);
  return match ? match[1].toLowerCase() : null;
}

function expectedHeaders(headers, hash, https) {
  const list = [
    ["Content-Security-Policy", headers.appCsp(hash)],
    ["X-Frame-Options", "DENY"],
    ...Object.entries(headers.COMMON_HEADERS),
  ];
  if (https) list.push(["Strict-Transport-Security", headers.HSTS_VALUE]);
  return list;
}

/** Returns the config with owned headers rewritten. */
function rewrite(source, expected) {
  const lines = source.split("\n");
  const out = [];
  let location = null;

  const flush = () => {
    if (!location) return;
    const body = location.lines;
    const isStatic = body.some((line) => /^\s*root \/app\/html;/.test(line));
    const kept = body.filter((line) => !OWNED.includes(headerName(line)));
    if (isStatic) {
      const indent = /^(\s*)/.exec(kept[1] ?? "            ")[1];
      // After root/index/expires, before Cache-Control and try_files.
      let at = 1;
      while (at < kept.length && /^\s*(root|index|expires)\s/.test(kept[at]))
        at++;
      const added = expected.map(
        ([name, value]) => `${indent}add_header ${name} "${value}" always;`,
      );
      kept.splice(at, 0, ...added);
    }
    out.push(...kept);
    location = null;
  };

  for (const line of lines) {
    if (location) {
      location.lines.push(line);
      if (/^\s*\}\s*$/.test(line) && line.indexOf("}") === location.indent) {
        flush();
      }
      continue;
    }
    const start = /^(\s*)location\s.*\{\s*$/.exec(line);
    if (start) {
      location = { indent: start[1].length, lines: [line] };
      continue;
    }
    // Server level owned headers would reach proxied responses too.
    if (OWNED.includes(headerName(line))) continue;
    out.push(line);
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

async function main() {
  const { pathToFileURL } = require("node:url");
  const headers = await import(
    pathToFileURL(path.join(ROOT, "src/backend/http/security-headers.ts")).href
  );
  const { sharedModules, productionImportMap, importMapCspHash } =
    await import("./lib/plugin-import-map.mjs");
  const hash = importMapCspHash(productionImportMap(sharedModules()));
  const write = process.argv.includes("--write");
  const problems = [];

  for (const { file: relative, https } of CONFIGS) {
    const file = path.join(ROOT, relative);
    const source = fs.readFileSync(file, "utf8");
    const next = rewrite(source, expectedHeaders(headers, hash, https));
    if (!/root \/app\/html;/.test(source)) {
      problems.push(`${relative}: no location serves /app/html`);
    } else if (next !== source) {
      if (write) fs.writeFileSync(file, next);
      else problems.push(`${relative}: security headers are out of date`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(
      "The security headers or the plugin import map changed. Run: node scripts/check-importmap-csp.cjs --write",
    );
    process.exit(1);
  }
  if (write) console.log(`import map CSP hash: ${hash}`);
}

module.exports = { rewrite, expectedHeaders };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
