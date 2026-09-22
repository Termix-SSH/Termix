import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest } from "../lib/plugin-dir.mjs";

/**
 * The manifest rules live in src/manifest.ts, which the server uses too, so
 * there is one implementation rather than a copy here that drifts.
 */
async function loadParseManifest() {
  const entry = new URL("../../dist/manifest.js", import.meta.url);
  if (!fs.existsSync(fileURLToPath(entry))) {
    throw new Error("The plugin SDK is not built yet. Run: npm run build:sdk");
  }
  const mod = await import(entry.href);
  return mod.parseManifest;
}

export async function validate({ cwd }) {
  const raw = readManifest(cwd);
  const parseManifest = await loadParseManifest();
  const { errors } = parseManifest(raw);

  const problems = [...errors];

  // The manifest names files. They have to be there.
  const referenced = [
    raw.backend ?? "dist/backend.js",
    raw.frontend ?? "dist/frontend.js",
    raw.locales ?? "locales",
  ];
  for (const rel of referenced) {
    if (!fs.existsSync(path.join(cwd, rel))) {
      problems.push(`manifest references ${rel}, which does not exist`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error(`${raw.id ?? path.basename(cwd)}: manifest is not valid.`);
  }

  console.log(`ok  ${raw.id ?? path.basename(cwd)}`);
}
