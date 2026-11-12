/**
 * Cookie names for the session and login cookies. Over HTTPS they get the
 * __Host- prefix, which makes the browser refuse them unless they are Secure,
 * host only and on Path=/, so a sibling subdomain can't plant or overwrite
 * one. Plain HTTP keeps the old names.
 *
 * Plugins and older code read the old names, and proxy plugins strip Termix
 * cookies by those names before forwarding a request. So the request Cookie
 * header is rewritten back to the old names before anything reads it.
 */

import type { NextFunction, Request, Response } from "express";
import { isSecureRequest } from "../http/security-headers.js";

export const SESSION_COOKIE = "jwt";
const HOST_PREFIX = "__Host-";

/** Cookies that get the prefix. */
const PREFIXED = new Set([
  SESSION_COOKIE,
  "termix_pending_login",
  "termix_trust_device",
]);

export function cookieNameFor(req: Request, name: string): string {
  return PREFIXED.has(name) && isSecureRequest(req)
    ? `${HOST_PREFIX}${name}`
    : name;
}

/**
 * Rewrites a Cookie header so prefixed cookies appear under their old
 * names. A prefixed cookie wins over a plain one with the same name, since
 * only the prefixed one is known to come from this host.
 */
export function normalizeCookieHeader(header: string): string {
  const pairs = header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const prefixed = new Set<string>();
  for (const pair of pairs) {
    const name = pair.split("=", 1)[0];
    if (name.startsWith(HOST_PREFIX)) {
      const base = name.slice(HOST_PREFIX.length);
      if (PREFIXED.has(base)) prefixed.add(base);
    }
  }
  if (prefixed.size === 0) return header;
  const out: string[] = [];
  for (const pair of pairs) {
    const name = pair.split("=", 1)[0];
    if (prefixed.has(name)) continue;
    if (name.startsWith(HOST_PREFIX)) {
      const base = name.slice(HOST_PREFIX.length);
      if (prefixed.has(base)) {
        out.push(`${base}${pair.slice(name.length)}`);
        continue;
      }
    }
    out.push(pair);
  }
  return out.join("; ");
}

/** Runs before cookie-parser. */
export function normalizeCookiesMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.cookie;
  if (header) req.headers.cookie = normalizeCookieHeader(header);
  next();
}

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge?: number;
}

/** Sets name (an old name) under the right name for this request. */
export function setAuthCookie(
  req: Request,
  res: Response,
  name: string,
  value: string,
  options: CookieOptions,
): Response {
  const actual = cookieNameFor(req, name);
  if (actual !== name) {
    // A plain cookie from before HTTPS was turned on would linger.
    res.clearCookie(name, { ...options, maxAge: undefined });
    return res.cookie(actual, value, { ...options, secure: true, path: "/" });
  }
  return res.cookie(name, value, options);
}

/** Clears both the plain and the prefixed cookie. */
export function clearAuthCookie(
  req: Request,
  res: Response,
  name: string,
  options: Omit<CookieOptions, "maxAge">,
): Response {
  res.clearCookie(name, options);
  if (PREFIXED.has(name) && isSecureRequest(req)) {
    res.clearCookie(`${HOST_PREFIX}${name}`, {
      ...options,
      secure: true,
      path: "/",
    });
  }
  return res;
}
