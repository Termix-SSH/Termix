// The built page plugin views run in (dist/frame), served to every framed
// plugin under /plugin-assets/<id>/_frame/.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readImportMapHash, type ScriptHash } from "./security-headers.js";
import { DESKTOP_APP_ORIGIN } from "../utils/cors-config.js";

/** The built page, served as /plugin-assets/<id>/_frame/. */
export const FRAME_PAGE = "frame.html";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/** Docker keeps the UI for nginx elsewhere, so Node gets its own copy. */
export function frameRuntimeCandidates(): string[] {
  return [
    process.env.TERMIX_FRAME_DIR ?? "",
    // The desktop app: dist/backend/backend/http next to dist/frame.
    path.join(here, "../../../frame"),
    path.join(here, "../../../dist/frame"),
    path.join(here, "../../dist/frame"),
    path.join(process.cwd(), "dist/frame"),
  ].filter(Boolean);
}

let frameDir: string | null = null;

/**
 * Found once it exists. In dev the backend starts before the frame build
 * finishes, so a miss is looked up again next time.
 */
export function findFrameRuntimeDir(): string | null {
  if (!frameDir) {
    frameDir =
      frameRuntimeCandidates().find((dir) =>
        fs.existsSync(path.join(dir, FRAME_PAGE)),
      ) ?? null;
  }
  return frameDir;
}

let hash: { value: ScriptHash; stamp: number } | null = null;

/** Read again only when the frame page was rebuilt. */
export function frameImportMapHash(): ScriptHash | null {
  const dir = findFrameRuntimeDir();
  if (!dir) return null;
  let stamp = 0;
  try {
    stamp = fs.statSync(path.join(dir, FRAME_PAGE)).mtimeMs;
  } catch {
    return null;
  }
  if (hash?.stamp !== stamp) {
    const value = readImportMapHash(dir, FRAME_PAGE);
    hash = value ? { value, stamp } : null;
  }
  return hash?.value ?? null;
}

/**
 * Pages besides the server itself that may hold plugin frames: the desktop
 * app (local backend or a linked server), and the dev server for the
 * embedded backend.
 */
export function frameAncestors(): string[] {
  const extra = [DESKTOP_APP_ORIGIN];
  if (process.env.ELECTRON_EMBEDDED === "true") extra.push(...DEV_ORIGINS);
  return extra;
}

/** Test seam. */
export function resetFrameRuntime(): void {
  frameDir = null;
  hash = null;
}
