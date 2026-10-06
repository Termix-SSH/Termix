import fs from "node:fs";
import path from "node:path";
import { readManifest } from "../lib/plugin-dir.mjs";
import { loadSdkModule } from "./validate.mjs";

/**
 * Prints one version's notes from CHANGELOG.md, the manifest version unless
 * --version says otherwise. The release workflow uses it as the release body.
 */
export async function changelog({ cwd, args = [] }) {
  const index = args.indexOf("--version");
  const version =
    index === -1 ? readManifest(cwd).version : args[index + 1] || null;
  if (!version) throw new Error("--version needs a value");

  const file = path.join(cwd, "CHANGELOG.md");
  if (!fs.existsSync(file)) throw new Error("There is no CHANGELOG.md");

  const { changelogSection } = await loadSdkModule("changelog");
  const section = changelogSection(fs.readFileSync(file, "utf8"), version);
  if (!section) {
    throw new Error(`CHANGELOG.md has no notes for ${version}`);
  }
  process.stdout.write(`${section}\n`);
}
