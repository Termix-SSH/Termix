import fs from "node:fs";
import path from "node:path";
import { create } from "tar";
import { readManifest } from "../lib/plugin-dir.mjs";

/** Everything a server needs to run the plugin, and nothing else. D3 signs it. */
const CONTENTS = [
  "manifest.json",
  "dist",
  "locales",
  "migrations",
  "README.md",
  "CHANGELOG.md",
];

export async function pack({ cwd }) {
  const manifest = readManifest(cwd);
  const pluginId = manifest.id ?? path.basename(cwd);
  const version = manifest.version ?? "0.0.0";

  if (!fs.existsSync(path.join(cwd, "dist", "backend.js"))) {
    throw new Error(`${pluginId}: nothing built. Run termix-plugin build.`);
  }

  const files = CONTENTS.filter((entry) =>
    fs.existsSync(path.join(cwd, entry)),
  );
  const outfile = path.join(cwd, `${pluginId}-${version}.tgz`);

  await create({ gzip: true, cwd, file: outfile }, files);

  console.log(`packed ${path.basename(outfile)}`);
}
