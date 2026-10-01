import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

let cached: string | null | undefined;

function readVersion(file: string): string | null {
  try {
    const version = JSON.parse(fs.readFileSync(file, "utf8")).version;
    return typeof version === "string" && version !== "unknown"
      ? version
      : null;
  } catch {
    return null;
  }
}

/** This install's version: VERSION, else the nearest package.json. */
export function getLocalVersion(): string | null {
  if (cached !== undefined) return cached;
  cached =
    process.env.VERSION ||
    readVersion(path.resolve(process.cwd(), "package.json")) ||
    readVersion(path.resolve("/app", "package.json")) ||
    readVersion(path.resolve(here, "../../../package.json")) ||
    readVersion(path.resolve(here, "../../../../package.json")) ||
    null;
  return cached;
}
