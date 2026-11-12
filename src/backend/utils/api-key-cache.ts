import crypto from "crypto";

/**
 * Remembers which stored key an API token already matched, so a client
 * sending the same key on every request pays bcrypt once instead of each
 * time. Only a SHA-256 of the token is kept. A hit still has to name a key
 * that is active and unchanged in the database right now, so revoking or
 * rotating a key takes effect at once.
 */

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 1000;

interface Entry {
  keyId: string;
  tokenHash: string;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

function digest(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** The candidate this token matched before, if it is still the same key. */
export function cachedApiKeyMatch<T extends { id: string; tokenHash: string }>(
  token: string,
  candidates: T[],
  now = Date.now(),
): T | null {
  const id = digest(token);
  const entry = entries.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    entries.delete(id);
    return null;
  }
  const match = candidates.find(
    (candidate) =>
      candidate.id === entry.keyId && candidate.tokenHash === entry.tokenHash,
  );
  if (!match) entries.delete(id);
  return match ?? null;
}

export function rememberApiKeyMatch(
  token: string,
  key: { id: string; tokenHash: string },
  now = Date.now(),
): void {
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(digest(token), {
    keyId: key.id,
    tokenHash: key.tokenHash,
    expiresAt: now + TTL_MS,
  });
}

export function clearApiKeyCache(): void {
  entries.clear();
}
