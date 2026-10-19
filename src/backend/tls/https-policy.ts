/**
 * Admin option force_https: when HTTPS is on, plain HTTP requests are sent to
 * the HTTPS port and HTTPS responses carry HSTS. Off by default, so a reverse
 * proxy that terminates TLS itself keeps working. A request counts as HTTPS
 * when it came in over TLS or a proxy says so in X-Forwarded-Proto.
 */

import type { NextFunction, Request, Response } from "express";
import { createCurrentSettingsRepository } from "../database/repositories/factory.js";
import { getTlsConfig } from "./tls-service.js";

export const FORCE_HTTPS_KEY = "force_https";
const HSTS = "max-age=31536000";
// Certificate checks and health probes must still work over plain HTTP.
const EXEMPT = [/^\/\.well-known\/acme-challenge\//, /^\/health$/];

let forceHttps: boolean | null = null;

export async function isForceHttpsEnabled(): Promise<boolean> {
  if (forceHttps === null) {
    forceHttps = await createCurrentSettingsRepository()
      .getBoolean(FORCE_HTTPS_KEY, false)
      .catch(() => false);
  }
  return forceHttps;
}

export async function setForceHttps(enabled: boolean): Promise<void> {
  await createCurrentSettingsRepository().set(
    FORCE_HTTPS_KEY,
    enabled ? "true" : "false",
  );
  forceHttps = enabled;
}

/** Test seam. */
export function resetHttpsPolicyForTests(): void {
  forceHttps = null;
}

export function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const forwarded = req.get("x-forwarded-proto");
  return forwarded?.split(",")[0].trim().toLowerCase() === "https";
}

function httpsUrl(req: Request, port: number): string {
  const host = (req.get("host") || "localhost").replace(/:\d+$/, "");
  const suffix = port === 443 ? "" : `:${port}`;
  return `https://${host}${suffix}${req.originalUrl || req.url}`;
}

export async function httpsPolicyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tls = getTlsConfig();
    if (!tls.enabled || !(await isForceHttpsEnabled())) return next();
    if (isSecureRequest(req)) {
      res.setHeader("Strict-Transport-Security", HSTS);
      return next();
    }
    if (EXEMPT.some((pattern) => pattern.test(req.path))) return next();
    res.redirect(308, httpsUrl(req, tls.port));
  } catch (error) {
    next(error);
  }
}
