/**
 * When each signed in user last proved a second factor, for rules that ask
 * again before something sensitive, such as connecting to a host. Bound to
 * sessionId when available (falling back to userId when no sessionId exists).
 * Kept in memory with periodic expiration cleanup: a restart only means
 * proving it once more.
 */

const STEP_UP_TTL_MS = 24 * 60 * 60 * 1000;
const STEP_UP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

interface StepUpEntry {
  verifiedAt: number;
  recordedAt: number;
}

const verified = new Map<string, StepUpEntry>();

function stepUpKey(userId: string, sessionId?: string): string {
  return sessionId ? `session:${userId}:${sessionId}` : `user:${userId}`;
}

function pruneExpiredStepUps(now = Date.now()): void {
  for (const [key, entry] of verified) {
    if (now - entry.recordedAt > STEP_UP_TTL_MS) {
      verified.delete(key);
    }
  }
}

const cleanupTimer = setInterval(
  () => pruneExpiredStepUps(),
  STEP_UP_CLEANUP_INTERVAL_MS,
);
cleanupTimer.unref?.();

export function recordStepUp(
  userId: string,
  now = Date.now(),
  sessionId?: string,
): void {
  verified.set(stepUpKey(userId, sessionId), {
    verifiedAt: now,
    recordedAt: Date.now(),
  });
}

export function stepUpAt(userId: string, sessionId?: string): number | null {
  const now = Date.now();
  if (sessionId) {
    const key = stepUpKey(userId, sessionId);
    const entry = verified.get(key);
    if (!entry) return null;
    if (now - entry.recordedAt > STEP_UP_TTL_MS) {
      verified.delete(key);
      return null;
    }
    return entry.verifiedAt;
  }

  const userKey = stepUpKey(userId);
  const direct = verified.get(userKey);
  if (direct) {
    if (now - direct.recordedAt <= STEP_UP_TTL_MS) {
      return direct.verifiedAt;
    }
    verified.delete(userKey);
  }

  const prefix = `session:${userId}:`;
  let latest: number | null = null;
  for (const [key, entry] of verified) {
    if (!key.startsWith(prefix)) continue;
    if (now - entry.recordedAt > STEP_UP_TTL_MS) {
      verified.delete(key);
      continue;
    }
    if (latest === null || entry.verifiedAt > latest) {
      latest = entry.verifiedAt;
    }
  }
  return latest;
}

export function clearStepUp(userId: string, sessionId?: string): void {
  if (sessionId) {
    verified.delete(stepUpKey(userId, sessionId));
    return;
  }
  verified.delete(stepUpKey(userId));
  const prefix = `session:${userId}:`;
  for (const key of verified.keys()) {
    if (key.startsWith(prefix)) {
      verified.delete(key);
    }
  }
}
