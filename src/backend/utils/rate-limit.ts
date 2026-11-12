/**
 * Volume limits for routes that are easy to abuse: logins, second factors,
 * password resets, API keys, exports and other work that costs a lot of CPU.
 * Counted per client IP and per account (the username a request names, or
 * the session it is signed in with). Kept in memory, so each backend
 * instance counts on its own.
 *
 * login-rate-limiter.ts still locks out after failed passwords; this caps
 * how many requests reach those checks at all.
 */

import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { getClientIp } from "./request-origin.js";

export interface RateLimit {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

export interface RateLimitRule {
  name: string;
  methods: string[];
  path: RegExp;
  perIp?: RateLimit;
  perAccount?: RateLimit;
  account?: (req: Request) => string | null;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const sweep = setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  },
  5 * 60 * 1000,
);
sweep.unref?.();

/** Counts one hit. Returns seconds to wait when over the limit, else 0. */
export function hit(key: string, limit: RateLimit, now = Date.now()): number {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + limit.windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= limit.max) return 0;
  return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
}

export function resetRateLimits(): void {
  buckets.clear();
}

/** The username a login style request names, lowercased. */
export function usernameAccount(req: Request): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  const name = body?.username;
  return typeof name === "string" && name.trim()
    ? `user:${name.trim().toLowerCase()}`
    : null;
}

/**
 * The session a request is signed in with. Hashed so the key never holds the
 * token. Not the user id: that would mean trusting an unverified token.
 */
export function sessionAccount(req: Request): string | null {
  const auth = req.headers?.authorization;
  const token =
    (auth?.startsWith("Bearer ") ? auth.slice(7) : null) ||
    (req.cookies as Record<string, string> | undefined)?.jwt;
  if (!token) return null;
  return `session:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

function refuse(res: Response, retryAfter: number): void {
  res.setHeader("Retry-After", String(retryAfter));
  res.status(429).json({
    error: "Too many requests. Try again later.",
    code: "RATE_LIMITED",
    retryAfter,
  });
}

/** One middleware that applies every matching rule. */
export function rateLimitMiddleware(rules: RateLimitRule[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // The authorization matrix calls every route from one address.
    if (process.env.TERMIX_AUTHZ_NO_RATE_LIMITS === "1") return next();
    for (const rule of rules) {
      if (!rule.methods.includes(req.method)) continue;
      if (!rule.path.test(req.path)) continue;
      if (rule.perIp) {
        const wait = hit(`${rule.name}:ip:${getClientIp(req)}`, rule.perIp);
        if (wait) return refuse(res, wait);
      }
      const account = rule.perAccount && rule.account?.(req);
      if (account) {
        const wait = hit(`${rule.name}:${account}`, rule.perAccount);
        if (wait) return refuse(res, wait);
      }
    }
    next();
  };
}

const MINUTE = 60 * 1000;

/** Core's limits. Generous for people, tight for scripts. */
export const CORE_RATE_LIMITS: RateLimitRule[] = [
  {
    name: "login",
    methods: ["POST"],
    path: /^\/users\/(login|proxy-login|[^/]+\/login|auth\/[^/]+\/(verify|callback))$/,
    perIp: { max: 30, windowMs: MINUTE },
    perAccount: { max: 10, windowMs: MINUTE },
    account: usernameAccount,
  },
  {
    // Redirect logins finish with a GET from the identity provider.
    name: "login-callback",
    methods: ["GET"],
    path: /^\/users\/auth\/[^/]+\/callback$/,
    perIp: { max: 30, windowMs: MINUTE },
  },
  {
    name: "second-factor",
    methods: ["POST"],
    path: /^\/users\/(totp\/verify-login|auth\/second-factor\/[^/]+\/(challenge|verify)|auth\/step-up\/[^/]+\/(challenge|verify))$/,
    perIp: { max: 30, windowMs: MINUTE },
    perAccount: { max: 15, windowMs: MINUTE },
    account: sessionAccount,
  },
  {
    name: "register",
    methods: ["POST"],
    path: /^\/users\/create$/,
    perIp: { max: 10, windowMs: 60 * MINUTE },
  },
  {
    name: "password-reset",
    methods: ["POST"],
    path: /^\/users\/(initiate-reset|verify-reset-code|complete-reset)$/,
    perIp: { max: 20, windowMs: 15 * MINUTE },
    perAccount: { max: 10, windowMs: 15 * MINUTE },
    account: usernameAccount,
  },
  {
    name: "password-check",
    methods: ["POST", "DELETE"],
    path: /^\/users\/(change-password|unlock-data|delete-account|delete-user)$/,
    perIp: { max: 30, windowMs: 15 * MINUTE },
    perAccount: { max: 10, windowMs: 15 * MINUTE },
    account: sessionAccount,
  },
  {
    name: "api-keys",
    methods: ["POST"],
    path: /^\/users\/api-keys$/,
    perAccount: { max: 20, windowMs: 60 * MINUTE },
    account: sessionAccount,
  },
  {
    name: "socket-ticket",
    methods: ["POST"],
    path: /^\/users\/ws-ticket(\/api-key)?$/,
    perIp: { max: 600, windowMs: MINUTE },
    perAccount: { max: 300, windowMs: MINUTE },
    account: sessionAccount,
  },
  {
    name: "export",
    methods: ["GET", "POST"],
    path: /^\/(database\/(export|export\/preview|import|restore)|users\/admin\/export\/[^/]+)$/,
    perIp: { max: 30, windowMs: 10 * MINUTE },
    perAccount: { max: 10, windowMs: 10 * MINUTE },
    account: sessionAccount,
  },
];

const API_KEY_FAILURE_LIMIT: RateLimit = { max: 20, windowMs: 10 * MINUTE };

/** Seconds a client must wait after too many bad API keys, else 0. */
export function apiKeyFailureWait(ip: string): number {
  const bucket = buckets.get(`api-key-fail:${ip}`);
  if (!bucket || bucket.resetAt <= Date.now()) return 0;
  if (bucket.count < API_KEY_FAILURE_LIMIT.max) return 0;
  return Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
}

export function recordApiKeyFailure(ip: string): void {
  hit(`api-key-fail:${ip}`, API_KEY_FAILURE_LIMIT);
}

export { refuse as sendRateLimited };
