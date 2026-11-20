/**
 * Hands a browser sign in to the mobile app. The app opens the login page
 * with a challenge (base64url SHA-256 of a secret it keeps). A login answer
 * for a request carrying that challenge also gets a one-time code, the page
 * sends the code to the app, and only the app, which holds the secret, can
 * trade it for the session.
 */

import crypto from "crypto";
import type { Request } from "express";

export const APP_CHALLENGE_HEADER = "x-termix-app-challenge";

const TTL_MS = 2 * 60 * 1000;
const MAX_CODES = 500;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

interface Handoff {
  token: string;
  challenge: string;
  expiresAt: number;
}

// Keyed by the code's hash, so the codes themselves are never kept.
const handoffs = new Map<string, Handoff>();

const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("base64url");

function prune(now: number): void {
  for (const [key, entry] of handoffs) {
    if (entry.expiresAt <= now) handoffs.delete(key);
  }
  while (handoffs.size >= MAX_CODES) {
    const oldest = handoffs.keys().next().value;
    if (oldest === undefined) break;
    handoffs.delete(oldest);
  }
}

/** The app's challenge on a login request, or null. */
export function appChallengeOf(req: Request): string | null {
  const value = req.get(APP_CHALLENGE_HEADER);
  return value && CHALLENGE.test(value) ? value : null;
}

/** A one-time code for this session, bound to the app's challenge. */
export function createAppHandoff(
  token: string,
  challenge: string,
  now = Date.now(),
): string {
  prune(now);
  const code = crypto.randomBytes(32).toString("base64url");
  handoffs.set(hash(code), { token, challenge, expiresAt: now + TTL_MS });
  return code;
}

/**
 * The session for a code, when the verifier matches its challenge. A code
 * works once and is gone after any try.
 */
export function redeemAppHandoff(
  code: unknown,
  verifier: unknown,
  now = Date.now(),
): string | null {
  if (typeof code !== "string" || typeof verifier !== "string") return null;
  if (!code || code.length > 128 || !VERIFIER.test(verifier)) return null;
  const key = hash(code);
  const entry = handoffs.get(key);
  if (!entry) return null;
  handoffs.delete(key);
  if (entry.expiresAt <= now) return null;
  const expected = Buffer.from(entry.challenge);
  const actual = Buffer.from(hash(verifier));
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    return null;
  }
  return entry.token;
}

/** For tests. */
export function clearAppHandoffs(): void {
  handoffs.clear();
}
