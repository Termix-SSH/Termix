// Serves the packaged UI from app://termix instead of file://. Only files
// inside dist/ can be read, so the page has one fixed origin and no reach
// into the rest of the disk.

const fs = require("fs");
const path = require("path");

const APP_SCHEME = "app";
const APP_HOST = "termix";
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;
// An empty page on the app origin, used only to move saved storage over.
const APP_BLANK_PATH = "/__termix-blank.html";
const APP_BLANK_URL = `${APP_ORIGIN}${APP_BLANK_PATH}`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

// The page's meta CSP holds the script rules (it needs the importmap hash).
// These are the ones a meta tag cannot carry or that never change.
const HTML_CSP = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

// Node gives custom schemes an opaque origin, so the parts are compared.
function isAppUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === `${APP_SCHEME}:` &&
      url.hostname.toLowerCase() === APP_HOST &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function inside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

/**
 * The file under root an app:// URL names, or null. A path with no extension
 * that is not a file is a page route and gets index.html.
 */
function resolveAppFile(root, requestUrl, fsImpl = fs) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (!isAppUrl(requestUrl)) return null;
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0") || rel.includes("\\")) return null;
  if (rel.split("/").some((part) => part === "..")) return null;

  let realRoot;
  try {
    realRoot = fsImpl.realpathSync(root);
  } catch {
    realRoot = path.resolve(root);
  }
  const index = path.join(realRoot, "index.html");
  const target = path.resolve(realRoot, `.${path.posix.normalize(rel)}`);
  if (!inside(realRoot, target)) return null;

  let real = null;
  try {
    real = fsImpl.realpathSync(target);
  } catch {
    real = null;
  }
  if (real) {
    if (!inside(realRoot, real)) return null;
    if (fsImpl.statSync(real).isFile()) return real;
  }
  return path.extname(rel) ? null : index;
}

function headersFor(file) {
  const ext = path.extname(file).toLowerCase();
  const headers = {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (ext === ".html") {
    headers["Content-Security-Policy"] = HTML_CSP;
    headers["Cache-Control"] = "no-cache";
  }
  return headers;
}

function createAppHandler(root, fsImpl = fs) {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (new URL(request.url).pathname === APP_BLANK_PATH) {
      return new Response("<!doctype html><title></title>", {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'",
        },
      });
    }
    const file = resolveAppFile(root, request.url, fsImpl);
    if (!file) return new Response("Not found", { status: 404 });
    try {
      const body = await fsImpl.promises.readFile(file);
      return new Response(request.method === "HEAD" ? null : body, {
        status: 200,
        headers: headersFor(file),
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  };
}

function serveApp(ses, root) {
  ses.protocol.handle(APP_SCHEME, createAppHandler(root));
}

module.exports = {
  APP_BLANK_URL,
  APP_HOST,
  APP_INDEX_URL,
  APP_ORIGIN,
  APP_SCHEME,
  HTML_CSP,
  createAppHandler,
  headersFor,
  isAppUrl,
  registerAppScheme,
  resolveAppFile,
  serveApp,
};
