const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 60;
const attempts = new Map<string, { count: number; windowStart: number }>();

export function isCollabGuestRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of attempts) {
    if (now - entry.windowStart > WINDOW_MS) attempts.delete(ip);
  }
}, 5 * WINDOW_MS).unref();
