/**
 * A per-IP fixed window, for the public guest endpoints. `dispose` stops the
 * sweep that forgets old windows.
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxAttempts: number;
}) {
  const attempts = new Map<string, { count: number; windowStart: number }>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of attempts) {
      if (now - entry.windowStart > options.windowMs) attempts.delete(ip);
    }
  }, 5 * options.windowMs);
  sweep.unref();

  return {
    /** Counts an attempt and says whether this IP is over the limit. */
    isLimited(ip: string): boolean {
      const now = Date.now();
      const entry = attempts.get(ip);
      if (!entry || now - entry.windowStart > options.windowMs) {
        attempts.set(ip, { count: 1, windowStart: now });
        return false;
      }
      entry.count += 1;
      return entry.count > options.maxAttempts;
    },
    dispose(): void {
      clearInterval(sweep);
      attempts.clear();
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
