import fs from "node:fs";
import path from "node:path";
import { readManifest } from "../lib/plugin-dir.mjs";
import { collectFiles, createTmxplug } from "../lib/tmxplug.mjs";
import { sha256 } from "../lib/signing.mjs";
import { validate } from "./validate.mjs";

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} needs a value`);
  return value;
}

/**
 * Writes <id>-<version>.tmxplug. Validates first and refuses on any error,
 * so a broken manifest never becomes a release.
 */
export async function pack({ cwd, args = [] }) {
  const manifest = readManifest(cwd);
  const pluginId = manifest.id ?? path.basename(cwd);
  const version = manifest.version ?? "0.0.0";

  if (!fs.existsSync(path.join(cwd, "dist", "backend.js"))) {
    throw new Error(`${pluginId}: nothing built. Run termix-plugin build.`);
  }

  await validate({ cwd });

  const outDir = path.resolve(cwd, readOption(args, "--out") ?? ".");
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, `${pluginId}-${version}.tmxplug`);

  const archive = createTmxplug(cwd, collectFiles(cwd));
  fs.writeFileSync(outfile, archive);

  console.log(`packed ${path.basename(outfile)}`);
  console.log(`  size    ${archive.length}`);
  console.log(`  sha256  ${sha256(archive).toString("hex")}`);
  return outfile;
}
