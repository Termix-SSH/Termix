import type { IncomingMessage } from "http";
import type { NextFunction, Request, Response } from "express";

export function isEmbeddedBackend(env: NodeJS.ProcessEnv = process.env) {
  return env.ELECTRON_EMBEDDED === "true";
}

const LOOPBACK_NAMES = ["127.0.0.1", "localhost", "[::1]"];

/**
 * Whether a request may reach the embedded desktop backend. Only loopback
 * names count, so a web page that points its own DNS name at 127.0.0.1 is
 * refused before any route runs.
 */
export function isEmbeddedHostAllowed(
  host: string | undefined,
  port: number,
): boolean {
  if (!host) return false;
  return LOOPBACK_NAMES.some((name) => host === `${name}:${port}`);
}

function embeddedPort(): number {
  return Number(process.env.EMBEDDED_BACKEND_PORT) || 30001;
}

export function embeddedHostRefused(req: IncomingMessage): boolean {
  return (
    isEmbeddedBackend() &&
    !isEmbeddedHostAllowed(req.headers.host, embeddedPort())
  );
}

export function embeddedHostGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (embeddedHostRefused(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
