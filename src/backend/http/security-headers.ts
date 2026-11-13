/**
 * Security headers for every response the backend sends. The nginx configs
 * carry the same values for the files nginx serves itself, and the desktop
 * build gets the app policy as a meta tag (see vite.config.ts). Tests keep all
 * three in step with this file.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

export const HSTS_VALUE = "max-age=31536000";

export const COMMON_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** Hash token for the inline import map, like 'sha256-...'. */
export type ScriptHash = string;

/** Extra script origins the desktop shell loads plugin code from. */
const DESKTOP_LOCAL = ["http://localhost:*", "http://127.0.0.1:*"];

function joinPolicy(directives: [string, string[]][]): string {
  return directives
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

function appDirectives(
  hash: ScriptHash | null,
  extra: string[] = [],
): [string, string[]][] {
  return [
    ["default-src", ["'self'", ...extra]],
    [
      "script-src",
      ["'self'", "'wasm-unsafe-eval'", ...(hash ? [hash] : []), ...extra],
    ],
    ["style-src", ["'self'", "'unsafe-inline'", ...extra]],
    ["img-src", ["'self'", "data:", "blob:", "http:", "https:"]],
    ["font-src", ["'self'", "data:", ...extra]],
    ["connect-src", ["'self'", "http:", "https:", "ws:", "wss:"]],
    ["media-src", ["'self'", "data:", "blob:", "http:", "https:"]],
    ["worker-src", ["'self'", "blob:", ...extra]],
    ["frame-src", ["http:", "https:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
  ];
}

/** CSP for the app shell (index.html). */
export function appCsp(hash: ScriptHash | null): string {
  return joinPolicy([...appDirectives(hash), ["frame-ancestors", ["'none'"]]]);
}

/**
 * The desktop loads index.html from file://, where only a meta tag works, and
 * pulls plugin bundles from its local backend. frame-ancestors is ignored in
 * a meta tag, so it is left out. On the web the stricter header also applies.
 */
export function desktopMetaCsp(hash: ScriptHash | null): string {
  return joinPolicy(appDirectives(hash, DESKTOP_LOCAL));
}

/** CSP for core JSON routes: nothing may load or frame them. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * Default for plugin routes and assets. A plugin page (status page, login
 * result) sets its own policy, which replaces this one.
 */
export const PLUGIN_CSP =
  "object-src 'none'; base-uri 'none'; frame-ancestors 'self'";

const PLUGIN_PREFIXES = ["/plugin-api/", "/plugin-assets/", "/plugin-ws/"];

export function isPluginPath(urlPath: string): boolean {
  return PLUGIN_PREFIXES.some((prefix) => urlPath.startsWith(prefix));
}

/** A request that arrived over TLS, directly or through the local proxy. */
export function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const header = req.headers?.["x-forwarded-proto"];
  const forwarded = Array.isArray(header) ? header[0] : header;
  return forwarded?.split(",")[0].trim().toLowerCase() === "https";
}

const IMPORT_MAP = /<script type="importmap">([\s\S]*?)<\/script>/;

/** Hash of the inline import map in a built index.html, or null if none. */
export function importMapHashFromHtml(html: string): ScriptHash | null {
  const match = IMPORT_MAP.exec(html);
  if (!match) return null;
  const digest = crypto
    .createHash("sha256")
    .update(match[1], "utf8")
    .digest("base64");
  return `'sha256-${digest}'`;
}

/** Reads the import map hash of the frontend build in dir, if there is one. */
export function readImportMapHash(dir: string | undefined): ScriptHash | null {
  if (!dir) return null;
  try {
    return importMapHashFromHtml(
      fs.readFileSync(path.join(dir, "index.html"), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * Sets the common headers and a CSP chosen by path. Responses that send the
 * app shell call setAppShellHeaders to swap in the app policy.
 */
export function securityHeadersMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.removeHeader("X-Powered-By");
    for (const [name, value] of Object.entries(COMMON_HEADERS)) {
      res.setHeader(name, value);
    }
    if (isSecureRequest(req)) {
      res.setHeader("Strict-Transport-Security", HSTS_VALUE);
    }
    if (isPluginPath(req.path)) {
      res.setHeader("Content-Security-Policy", PLUGIN_CSP);
    } else {
      res.setHeader("Content-Security-Policy", API_CSP);
      res.setHeader("X-Frame-Options", "DENY");
    }
    next();
  };
}

export function setAppShellHeaders(
  res: Response,
  hash: ScriptHash | null,
): void {
  res.setHeader("Content-Security-Policy", appCsp(hash));
  res.setHeader("X-Frame-Options", "DENY");
}
