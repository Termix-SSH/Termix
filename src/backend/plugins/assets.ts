// Serves a plugin's built frontend: its bundle, stylesheet and locales.
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
} from "@termix/plugin-sdk/manifest";
import type { LoadedPlugin } from "./loader.js";

type AssetPlugin = Pick<LoadedPlugin, "id" | "dir" | "manifest"> &
  Partial<Pick<LoadedPlugin, "state">>;

export interface PluginFrontendInfo {
  frontend: boolean;
  css: boolean;
  /** Changes whenever the built bundle does, for cache busting. */
  assetVersion: string | null;
  /** Language codes with a locale file, "en" plus xx_YY names. */
  locales: string[];
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
  };
  if (!plugin) return none;

  const locales: string[] = [];
  const dir = localesDir(plugin);
  if (dir && fileExists(path.join(dir, "en.json"))) locales.push("en");
  if (dir) {
    try {
      for (const name of fs.readdirSync(path.join(dir, "translated"))) {
        if (/^[a-z]{2}_[A-Z]{2}\.json$/.test(name)) {
          locales.push(name.slice(0, -".json".length));
        }
      }
    } catch {
      // No translations yet.
    }
  }

  const entry = frontendEntry(plugin);
  if (!entry || !fileExists(entry.file)) return { ...none, locales };

  const stat = fs.statSync(entry.file);
  const assetVersion = crypto
    .createHash("sha256")
    .update(`${plugin.manifest.version}:${stat.size}:${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 12);

  return {
    frontend: true,
    css: fileExists(path.join(entry.dir, "frontend.css")),
    assetVersion,
    locales: locales.sort(),
  };
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
  if (clean.startsWith("locales/")) {
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
};

export function createPluginAssetsRouter(
  getPlugin: (id: string) => AssetPlugin | undefined,
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
      const file =
        plugin && running ? resolvePluginAsset(plugin, params[1]) : null;

      // Loaded as a module from Electron's file:// page and the Vite dev
      // server, so any origin may read it. No credentials are involved.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.removeHeader("Access-Control-Allow-Credentials");
      res.setHeader("X-Content-Type-Options", "nosniff");

      if (!file) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res.setHeader(
        "Cache-Control",
        typeof req.query.v === "string" && req.query.v
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
      res.type(CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
      res.sendFile(file);
    },
  );

  return router;
}
