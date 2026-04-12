import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import { getRequestOrigin } from "./request-origin.js";

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const ELECTRON_FILE_ORIGIN = "file://";

function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (!envOrigins) return [];
  return envOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
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
    "Cache-Control",
    ...extraHeaders,
  ];

  return (req: Request, res: Response, next: NextFunction) => {
    const handler = cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (DEV_ORIGINS.includes(origin)) return callback(null, true);
        if (origin === ELECTRON_FILE_ORIGIN) return callback(null, true);

        const configured = getAllowedOrigins();
        if (configured.includes(origin)) return callback(null, true);

        const sameOrigin = getRequestOrigin(req);
        if (origin === sameOrigin) return callback(null, true);

        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods,
      allowedHeaders,
    });
    handler(req, res, next);
  };
}
