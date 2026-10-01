/**
 * ACME http-01 answers. The CA asks for /.well-known/acme-challenge/<token>
 * on port 80 of the domain, which no plugin route can own, so core serves
 * whatever a plugin published through ctx.system.publishHttpChallenge.
 */

import type { Request, Response } from "express";

const MAX_AGE_MS = 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

const challenges = new Map<string, { content: string; expiresAt: number }>();

/** Returns the undo. A challenge also expires on its own after an hour. */
export function publishChallenge(token: string, content: string): () => void {
  if (!TOKEN.test(token)) {
    throw new Error("ACME challenge tokens are base64url");
  }
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("ACME challenge content must be a non-empty string");
  }
  const entry = { content, expiresAt: Date.now() + MAX_AGE_MS };
  challenges.set(token, entry);
  return () => {
    if (challenges.get(token) === entry) challenges.delete(token);
  };
}

export function lookupChallenge(token: string): string | null {
  const entry = challenges.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    challenges.delete(token);
    return null;
  }
  return entry.content;
}

export function clearChallengesForTests(): void {
  challenges.clear();
}

/** GET /.well-known/acme-challenge/:token, public by design. */
export function acmeChallengeHandler(req: Request, res: Response): void {
  const content = lookupChallenge(String(req.params.token ?? ""));
  if (content === null) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res.status(200).type("text/plain").send(content);
}
