import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import { getRequestOrigin } from "./request-origin.js";

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
export const DESKTOP_APP_ORIGIN = "app://termix";
// Desktop builds before 26.11.2 load their page from file://.
const LEGACY_DESKTOP_ORIGIN = "file://";

function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (!envOrigins) return [];
  return envOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Origins allowed to drive the embedded desktop backend: the desktop app
 * itself and the dev server. Any website open in a browser on the same
 * machine can reach loopback too, so nothing else gets in.
 */
export function isDesktopAppOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return DEV_ORIGINS.includes(origin) || origin === DESKTOP_APP_ORIGIN;
}

/**
 * Plugin frames run sandboxed, so their requests carry Origin: null. They
 * reach only plugin routes and assets, with a frame token and no cookies.
 */
const FRAME_PATHS = ["/plugin-api/", "/plugin-assets/"];

export function isPluginFrameRequest(
  req: Request,
  origin: string | undefined,
): boolean {
  const path = req.path || req.url || "";
  return origin === "null" && FRAME_PATHS.some((p) => path.startsWith(p));
}

export function isCorsOriginAllowed(
  req: Request,
  origin: string | undefined,
): boolean {
  if (isDesktopAppOrigin(origin)) return true;
  if (isPluginFrameRequest(req, origin)) return true;

  const configured = getAllowedOrigins();
  if (process.env.ELECTRON_EMBEDDED === "true") {
    // Only the desktop app of the same build talks to this backend.
    return configured.includes(origin) || origin === getRequestOrigin(req);
  }
  if (origin === LEGACY_DESKTOP_ORIGIN) return true;
  if (configured.length === 0) return true;
  if (configured.includes(origin)) return true;

  return origin === getRequestOrigin(req);
}

/**
 * Origins that may send cookies and read the answer. Any other origin a server
 * lets in without an allowlist only gets CORS for requests without cookies,
 * so a page on a sibling subdomain can't read what the login cookie unlocks.
 */
export function isCorsCredentialedOrigin(
  req: Request,
  origin: string | undefined,
): boolean {
  if (origin === "null") return false;
  if (isDesktopAppOrigin(origin)) return true;
  if (getAllowedOrigins().includes(origin as string)) return true;
  if (
    process.env.ELECTRON_EMBEDDED !== "true" &&
    origin === LEGACY_DESKTOP_ORIGIN
  ) {
    return true;
  }
  return origin === getRequestOrigin(req);
}

export function createCorsMiddleware(
  methods: string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  extraHeaders: string[] = [],
) {
  const allowedHeaders = [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "User-Agent",
    "X-Electron-App",
    "X-Termix-Device-ID",
    "X-Termix-Trust-Token",
    "Cache-Control",
    "x-admin-target-user",
    ...extraHeaders,
  ];

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const handler = cors((_req, callback) => {
      if (!isCorsOriginAllowed(req, origin)) {
        callback(new Error("Not allowed by CORS"));
        return;
      }
      callback(null, {
        origin: true,
        credentials: isCorsCredentialedOrigin(req, origin),
        methods,
        allowedHeaders,
      });
    });
    // A refused origin is a 403, not a server error.
    handler(req, res, (error?: unknown) => {
      if (error) {
        res.status(403).json({ error: "Origin not allowed" });
        return;
      }
      next();
    });
  };
}
