import fs from "node:fs";
import path from "node:path";

export function readManifest(cwd) {
  const manifestPath = path.join(cwd, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest.json in ${cwd}`);
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`manifest.json is not valid JSON: ${error.message}`);
  }
}

/** The first of these that exists, or null. */
export function resolveEntry(cwd, candidates) {
  for (const candidate of candidates) {
    const full = path.join(cwd, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

export function copyDir(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.cpSync(from, to, { recursive: true });
  return true;
}
