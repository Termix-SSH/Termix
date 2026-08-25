import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import { getRequestOrigin } from "./request-origin.js";

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const ELECTRON_FILE_ORIGIN = "file://";

/** `http://localhost:1234`, `https://127.0.0.1`, `http://[::1]:5173`, ... */
const LOOPBACK_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (!envOrigins) return [];
  return envOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * A locally-running client (the desktop app, a dev server, a local script)
 * identifies itself by the origin it sends, never by the TCP peer address:
 * in every containerized deployment the backend is reached through the
 * bundled nginx on 127.0.0.1, so the peer address is loopback for *every*
 * request, including one a random website triggered in a victim's browser.
 * Deciding on the peer address therefore reflected any Origin at all with
 * `credentials: true`, which disabled the allowlist below entirely.
 */
export function isAllowedOrigin(origin: string, req: Request): boolean {
  if (DEV_ORIGINS.includes(origin)) return true;
  if (origin.startsWith(ELECTRON_FILE_ORIGIN)) return true;
  if (LOOPBACK_ORIGIN.test(origin)) return true;

  const configured = getAllowedOrigins();
  if (configured.includes("*") || configured.includes(origin)) return true;

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
    "Cache-Control",
    "x-admin-target-user",
    ...extraHeaders,
  ];

  return (req: Request, res: Response, next: NextFunction) => {
    const handler = cors({
      origin: (origin, callback) => {
        // No origin = same-origin or non-browser request (curl, the native
        // mobile app, internal service calls).
        if (!origin) return callback(null, true);

        if (isAllowedOrigin(origin, req)) return callback(null, true);

        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods,
      allowedHeaders,
    });
    handler(req, res, next);
  };
}
