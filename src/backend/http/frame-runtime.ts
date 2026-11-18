// The built page plugin views run in (dist/frame), served to every framed
// plugin under /plugin-assets/<id>/_frame/. Its scripts, styles and fonts are
// the same for every plugin, so the page points them at one versioned path,
// /plugin-assets/_runtime/<version>/, which the browser caches once.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { importMapHashFromHtml, type ScriptHash } from "./security-headers.js";
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

/** Where the shared runtime files are served, under /plugin-assets/. */
export const FRAME_RUNTIME_PREFIX = "_runtime/";

export interface FramePage {
  html: string;
  /** Changes with every frame build, so runtime files can be cached for good. */
  version: string;
  hash: ScriptHash | null;
}

/**
 * Points the page's relative URLs (scripts, styles, import map) at the
 * runtime path. Relative, since the page sits at
 * <prefix>/plugin-assets/<id>/_frame/ and a proxy may add the prefix.
 */
export function rewriteFramePage(html: string, version: string): string {
  return html.replace(
    /(["'])\.\//g,
    `$1../../${FRAME_RUNTIME_PREFIX}${version}/`,
  );
}

let page: { value: FramePage; stamp: number } | null = null;

/** The runtime files whose names carry no content hash, sorted. */
function sharedEntries(dir: string): string[] {
  try {
    return fs
      .readdirSync(path.join(dir, "shared"))
      .filter((name) => name.endsWith(".js"))
      .sort()
      .map((name) => path.join("shared", name));
  } catch {
    return [];
  }
}

/** The page as served. Read again only when the frame was rebuilt. */
export function framePage(): FramePage | null {
  const dir = findFrameRuntimeDir();
  if (!dir) return null;
  let stamp = 0;
  try {
    stamp = fs.statSync(path.join(dir, FRAME_PAGE)).mtimeMs;
  } catch {
    return null;
  }
  if (page?.stamp !== stamp) {
    try {
      const raw = fs.readFileSync(path.join(dir, FRAME_PAGE), "utf8");
      const digest = crypto.createHash("sha256").update(raw, "utf8");
      // The import map's shared entries keep their names between builds but
      // point at new chunks, so they count too or a cached copy goes stale.
      for (const name of sharedEntries(dir)) {
        digest.update(name).update(fs.readFileSync(path.join(dir, name)));
      }
      const version = digest.digest("hex").slice(0, 16);
      const html = rewriteFramePage(raw, version);
      page = {
        value: { html, version, hash: importMapHashFromHtml(html) },
        stamp,
      };
    } catch {
      page = null;
    }
  }
  return page?.value ?? null;
}

/** Hash of the served page's import map, for its CSP. */
export function frameImportMapHash(): ScriptHash | null {
  return framePage()?.hash ?? null;
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
  page = null;
}
