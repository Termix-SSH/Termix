// Serves a plugin's built frontend: its bundle, stylesheet, locales and the
// CSS files its themes declare.
//
// Unauthenticated on purpose, the same as /assets: import() cannot carry the
// bearer header, and nothing here is secret. It only ever serves files from
// the two directories a plugin ships for the browser, so a request can never
// reach the plugin's backend bundle, migrations or anything outside it, and
// only for a plugin that is running.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import {
  DEFAULT_BACKEND_ENTRY,
  DEFAULT_FRONTEND_ENTRY,
  DEFAULT_LOCALES_DIR,
  type PluginManifest,
} from "@termix-ssh/plugin-sdk/manifest";
import type { LoadedPlugin } from "./loader.js";
import {
  frontendIsolation,
  type FrontendIsolation,
} from "./frontend-isolation.js";

type AssetPlugin = Pick<LoadedPlugin, "id" | "dir" | "manifest"> &
  Partial<Pick<LoadedPlugin, "state" | "source" | "signedTier">>;

export interface PluginFrontendInfo {
  frontend: boolean;
  css: boolean;
  /** Changes whenever the built bundle does, for cache busting. */
  assetVersion: string | null;
  /** Language codes with a locale file, "en" plus xx_YY names. */
  locales: string[];
  /** Changes whenever a theme's CSS does, for its ?v= link. */
  themeVersion: string | null;
  /** "frame": the UI runs in sandboxed frames. "page": inside the shell. */
  frontendIsolation: FrontendIsolation;
}

/** Where a theme's CSS is served: /plugin-assets/<id>/_themes/<theme>.css. */
export const THEME_ASSET_PREFIX = "_themes/";

/** The declared CSS file of each of the plugin's themes, by theme id. */
function themeFiles(plugin: AssetPlugin): Map<string, string> {
  const files = new Map<string, string>();
  const manifest = plugin.manifest as PluginManifest;
  for (const theme of manifest.contributes?.themes ?? []) {
    const file = path.resolve(plugin.dir, theme.css);
    if (isInside(plugin.dir, file)) files.set(theme.id, file);
  }
  return files;
}

function frontendEntry(
  plugin: AssetPlugin,
): { dir: string; file: string } | null {
  const manifest = plugin.manifest as PluginManifest;
  const entry = path.resolve(
    plugin.dir,
    manifest.frontend ?? DEFAULT_FRONTEND_ENTRY,
  );
  if (!isInside(plugin.dir, entry)) return null;
  return { dir: path.dirname(entry), file: entry };
}

function localesDir(plugin: AssetPlugin): string | null {
  const manifest = plugin.manifest as PluginManifest;
  const dir = path.resolve(plugin.dir, manifest.locales ?? DEFAULT_LOCALES_DIR);
  return isInside(plugin.dir, dir) ? dir : null;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function describePluginFrontend(
  plugin: AssetPlugin | undefined,
): PluginFrontendInfo {
  const none: PluginFrontendInfo = {
    frontend: false,
    css: false,
    assetVersion: null,
    locales: [],
    themeVersion: null,
    frontendIsolation: "page",
  };
  if (!plugin) return none;
  none.frontendIsolation = frontendIsolation(plugin);

  const themes = [...themeFiles(plugin).values()].filter(fileExists);
  const themeVersion =
    themes.length > 0
      ? contentVersion(themes.sort(), plugin.manifest.version)
      : null;

  const locales: string[] = [];
  const localeFiles: string[] = [];
  const dir = localesDir(plugin);
  if (dir && fileExists(path.join(dir, "en.json"))) {
    locales.push("en");
    localeFiles.push(path.join(dir, "en.json"));
  }
  if (dir) {
    try {
      for (const name of fs.readdirSync(path.join(dir, "translated"))) {
        if (/^[a-z]{2}_[A-Z]{2}\.json$/.test(name)) {
          locales.push(name.slice(0, -".json".length));
          localeFiles.push(path.join(dir, "translated", name));
        }
      }
    } catch {
      // No translations yet.
    }
  }

  const entry = frontendEntry(plugin);
  if (!entry || !fileExists(entry.file))
    return { ...none, locales, themeVersion };

  const cssFile = path.join(entry.dir, "frontend.css");
  const css = fileExists(cssFile);
  // Locales share the version, so a translations-only update must change it.
  const assetVersion = contentVersion(
    [...(css ? [entry.file, cssFile] : [entry.file]), ...localeFiles.sort()],
    plugin.manifest.version,
  );

  return {
    frontend: true,
    css,
    assetVersion,
    locales: locales.sort(),
    themeVersion,
    frontendIsolation: none.frontendIsolation,
  };
}

const versionCache = new Map<string, { stamp: string; version: string }>();

/**
 * A hash of the bundle's bytes, not its mtime: assets are cached as immutable
 * for a year, and a rebuilt .tmxplug has a fixed mtime, so a same-size rebuild
 * would otherwise keep serving the stale copy. The CSS and locales are hashed
 * with the JS because all of them are served under the same version.
 */
function contentVersion(files: string[], version: string): string {
  // ctime, unlike mtime, cannot be set by tar, so an unpack always changes it.
  const stamp = [
    version,
    ...files.map((file) => {
      const stat = fs.statSync(file);
      return `${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    }),
  ].join("|");
  const key = files.join("|");
  const cached = versionCache.get(key);
  if (cached?.stamp === stamp) return cached.version;
  const hash = crypto.createHash("sha256").update(version);
  for (const file of files) hash.update(fs.readFileSync(file));
  const hashed = hash.digest("hex").slice(0, 12);
  versionCache.set(key, { stamp, version: hashed });
  return hashed;
}

/**
 * Maps a request path under /plugin-assets/<id>/ to a file, or null.
 *
 * `locales/...` reads the plugin's locales directory; anything else reads the
 * directory the frontend bundle sits in. Only .js, .css, .json and .map are
 * served, and never a path that escapes either directory.
 */
export function resolvePluginAsset(
  plugin: AssetPlugin,
  requestPath: string,
): string | null {
  const clean = requestPath.replace(/^\/+/, "");
  if (!clean || clean.includes("\0") || clean.includes("\\")) return null;
  if (!/\.(js|css|json|map)$/.test(clean)) return null;

  let root: string | null;
  let rest: string;
  if (clean.startsWith(THEME_ASSET_PREFIX)) {
    // Only a declared theme file, which the loader checked on load.
    const themeId = clean.slice(THEME_ASSET_PREFIX.length, -".css".length);
    const file = themeFiles(plugin).get(themeId);
    if (!file || !clean.endsWith(".css")) return null;
    root = path.dirname(file);
    rest = path.basename(file);
  } else if (clean.startsWith("locales/")) {
    root = localesDir(plugin);
    rest = clean.slice("locales/".length);
  } else {
    root = frontendEntry(plugin)?.dir ?? null;
    rest = clean;
    // The backend bundle sits beside the frontend one in dist/.
    if (/^backend\.js(\.map)?$/.test(rest)) return null;
  }
  if (!root) return null;

  const file = path.resolve(root, rest);
  if (!isInside(root, file) || !fileExists(file)) return null;

  // The text check above cannot see a symlink, so the real paths have to
  // agree too: a link inside dist/ must not reach a file outside the plugin.
  let real: string;
  try {
    real = fs.realpathSync(file);
    if (!isInside(fs.realpathSync(plugin.dir), real)) return null;
  } catch {
    return null;
  }
  if (isServerOnly(plugin, real)) return null;
  return file;
}

/** The backend entry and the migrations, wherever the manifest put them. */
function isServerOnly(plugin: AssetPlugin, real: string): boolean {
  const manifest = plugin.manifest as PluginManifest;
  const backend = path.resolve(
    plugin.dir,
    manifest.backend ?? DEFAULT_BACKEND_ENTRY,
  );
  const candidates = [backend, `${backend}.map`];
  for (const candidate of candidates) {
    try {
      if (fs.realpathSync(candidate) === real) return true;
    } catch {
      // Not there.
    }
  }
  const segments = path
    .relative(fs.realpathSync(plugin.dir), real)
    .split(path.sep);
  return segments.includes("migrations");
}

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Where every plugin's frame page is served: /plugin-assets/<id>/_frame/. */
export const FRAME_ASSET_PREFIX = "_frame/";

const FRAME_FILE = /^[A-Za-z0-9._/-]+\.(html|js|css|woff2|woff|ttf|svg|png)$/;

/**
 * Maps a path under _frame/ to a file of the built frame runtime, or null.
 * The runtime is core's own build, the same for every plugin.
 */
export function resolveFrameAsset(
  frameDir: string,
  requestPath: string,
): string | null {
  const rest = requestPath.slice(FRAME_ASSET_PREFIX.length) || "frame.html";
  if (!FRAME_FILE.test(rest) || rest.split("/").includes("..")) return null;
  // The fonts are the UI build's own, beside the frame folder.
  const root = rest.startsWith("fonts/")
    ? path.join(path.dirname(frameDir), "fonts")
    : frameDir;
  const name = rest.startsWith("fonts/") ? rest.slice("fonts/".length) : rest;
  const file = path.resolve(root, name);
  if (!isInside(root, file) || !fileExists(file)) return null;
  return file;
}

export interface PluginAssetsOptions {
  /** Where the built frame runtime (dist/frame) is, when there is one. */
  frameDir?: () => string | null;
  /** The CSP for a plugin's frame page, built from the request. */
  frameCsp?: (req: Request, pluginId: string) => string;
}

export function createPluginAssetsRouter(
  getPlugin: (id: string) => AssetPlugin | undefined,
  options: PluginAssetsOptions = {},
): express.Router {
  const router = express.Router();

  /**
   * @openapi
   * /plugin-assets/{pluginId}/{path}:
   *   get:
   *     summary: Serve a plugin's frontend bundle, stylesheet or locale file
   *     description: >
   *       Public, like the app's own /assets, because a module import cannot
   *       send an auth header and plugin frontends are not secret. Serves only
   *       the directory holding the plugin's frontend bundle and its locales
   *       directory. A `v` query parameter (the assetVersion from GET
   *       /plugins) makes the response cacheable for a year.
   *     tags:
   *       - Plugins
   *     parameters:
   *       - in: path
   *         name: pluginId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: v
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The file.
   *       404:
   *         description: Unknown or stopped plugin, or no such file.
   */
  router.get(
    /^\/([a-z][a-z0-9-]{1,39})\/(.+)$/,
    (req: Request, res: Response) => {
      const params = req.params as unknown as Record<string, string>;
      const pluginId = params[0];
      const plugin = getPlugin(pluginId);
      // A disabled or failed plugin serves nothing, so its bundle cannot be
      // loaded around the shell's own enabled check.
      const running = !!plugin && (!plugin.state || plugin.state === "active");
      const framePath = params[1].startsWith(FRAME_ASSET_PREFIX);
      const frameDir =
        framePath && plugin && running && frontendIsolation(plugin) === "frame"
          ? (options.frameDir?.() ?? null)
          : null;
      const file =
        !plugin || !running
          ? null
          : framePath
            ? frameDir
              ? resolveFrameAsset(frameDir, params[1])
              : null
            : resolvePluginAsset(plugin, params[1]);

      // Loaded as a module from Electron's file:// page and the Vite dev
      // server, so any origin may read it. No credentials are involved.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.removeHeader("Access-Control-Allow-Credentials");
      res.setHeader("X-Content-Type-Options", "nosniff");

      if (!file) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const page = framePath && path.extname(file) === ".html";
      if (page && options.frameCsp) {
        res.setHeader(
          "Content-Security-Policy",
          options.frameCsp(req, pluginId),
        );
      }
      const hashed =
        (framePath &&
          !page &&
          params[1].startsWith(`${FRAME_ASSET_PREFIX}assets/`)) ||
        (typeof req.query.v === "string" && !!req.query.v);
      res.setHeader(
        "Cache-Control",
        hashed ? "public, max-age=31536000, immutable" : "no-cache",
      );
      res.type(CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
      // Installed plugins unpack under .unpacked/, which send would refuse as a
      // dotfile path. resolvePluginAsset already kept the file in the plugin.
      res.sendFile(file, { dotfiles: "allow" }, (error) => {
        if (error && !res.headersSent) {
          res.status(404).json({ error: "Not found" });
        }
      });
    },
  );

  return router;
}
