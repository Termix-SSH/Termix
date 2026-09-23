#!/usr/bin/env node
/**
 * Keeps the nginx CSP in step with the plugin import map.
 *
 * index.html carries an inline <script type="importmap"> so plugin bundles
 * share the shell's React. The CSP only allows 'self' scripts, so the map is
 * allowed by its hash. The map's text is deterministic (see
 * scripts/lib/plugin-import-map.mjs), so its hash only changes when the list
 * of shared modules does, e.g. when a plugin starts importing another core
 * module. This fails lint until the nginx configs carry the new hash.
 *
 *   node scripts/check-importmap-csp.cjs          check
 *   node scripts/check-importmap-csp.cjs --write  update the configs
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONFIGS = ["docker/nginx.conf", "docker/nginx-https.conf"];
const SCRIPT_SRC = /script-src ([^;"]*)/;

async function main() {
  const { sharedModules, productionImportMap, importMapCspHash } =
    await import("./lib/plugin-import-map.mjs");
  const expected = importMapCspHash(productionImportMap(sharedModules(ROOT)));
  const write = process.argv.includes("--write");
  const problems = [];

  for (const relative of CONFIGS) {
    const file = path.join(ROOT, relative);
    const source = fs.readFileSync(file, "utf8");
    let changed = false;
    const next = source.replace(
      new RegExp(SCRIPT_SRC.source, "g"),
      (match, sources) => {
        const kept = sources
          .split(/\s+/)
          .filter(Boolean)
          .filter((token) => !token.startsWith("'sha256-"));
        const updated = `script-src ${[...kept, expected].join(" ")}`;
        if (updated !== match) changed = true;
        return updated;
      },
    );
    if (!SCRIPT_SRC.test(source)) {
      problems.push(`${relative}: no script-src directive`);
    } else if (changed) {
      if (write) fs.writeFileSync(file, next);
      else problems.push(`${relative}: script-src does not allow ${expected}`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(
      "The plugin import map changed. Run: node scripts/check-importmap-csp.cjs --write",
    );
    process.exit(1);
  }
  if (write) console.log(`import map CSP hash: ${expected}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
