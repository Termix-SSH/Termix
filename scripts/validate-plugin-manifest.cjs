/**
 * Validates plugin manifests against the SDK contract.
 *
 *   node scripts/validate-plugin-manifest.cjs                 # every bundled manifest
 *   node scripts/validate-plugin-manifest.cjs path/to/manifest.json
 *
 * The rules live in packages/plugin-sdk/src/manifest.ts, which the server
 * uses too, so there is one implementation rather than a copy here that
 * drifts. This file only finds the manifests and prints the result.
 */

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const sdkEntry = path.join(root, "packages", "plugin-sdk", "dist", "manifest.js");

async function loadValidator() {
  if (!fs.existsSync(sdkEntry)) {
    console.error(
      `The plugin SDK is not built yet (${path.relative(root, sdkEntry)} is missing).\n` +
        `Run: npm run build:sdk`,
    );
    process.exit(1);
  }
  return import(pathToFileURL(sdkEntry).href);
}

function bundledManifests() {
  const pluginsDir = path.join(root, "plugins");
  if (!fs.existsSync(pluginsDir)) return [];

  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginsDir, entry.name, "manifest.json"))
    .filter((file) => fs.existsSync(file));
}

async function main() {
  const { parseManifest } = await loadValidator();

  const argument = process.argv[2];
  const files = argument
    ? [path.resolve(process.cwd(), argument)]
    : bundledManifests();

  if (files.length === 0) {
    console.log("No plugin manifests found.");
    return;
  }

  let failed = 0;

  for (const file of files) {
    const relative = path.relative(root, file);

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      console.error(`${relative}: not valid JSON: ${error.message}`);
      failed += 1;
      continue;
    }

    const { errors } = parseManifest(raw);
    if (errors.length > 0) {
      console.error(`${relative}:`);
      for (const error of errors) console.error(`  - ${error}`);
      failed += 1;
      continue;
    }

    console.log(`ok  ${relative}`);
  }

  if (failed > 0) {
    console.error(`\n${failed} manifest(s) failed validation.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
