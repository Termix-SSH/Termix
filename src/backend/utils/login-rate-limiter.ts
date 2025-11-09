interface LoginAttempt {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}

class LoginRateLimiter {
  private ipAttempts = new Map<string, LoginAttempt>();
  private usernameAttempts = new Map<string, LoginAttempt>();

  private readonly MAX_ATTEMPTS = 5;
  private readonly WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  private readonly LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

  // Clean up old entries periodically
  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000); // Clean every 5 minutes
  }

  private cleanup(): void {
    const now = Date.now();

    // Clean IP attempts
    for (const [ip, attempt] of this.ipAttempts.entries()) {
      if (attempt.lockedUntil && attempt.lockedUntil < now) {
        this.ipAttempts.delete(ip);
      } else if (!attempt.lockedUntil && (now - attempt.firstAttempt) > this.WINDOW_MS) {
        this.ipAttempts.delete(ip);
      }
    }

    // Clean username attempts
    for (const [username, attempt] of this.usernameAttempts.entries()) {
      if (attempt.lockedUntil && attempt.lockedUntil < now) {
        this.usernameAttempts.delete(username);
      } else if (!attempt.lockedUntil && (now - attempt.firstAttempt) > this.WINDOW_MS) {
        this.usernameAttempts.delete(username);
      }
    }
  }

  recordFailedAttempt(ip: string, username?: string): void {
    const now = Date.now();

    // Record IP attempt
    const ipAttempt = this.ipAttempts.get(ip);
    if (!ipAttempt) {
      this.ipAttempts.set(ip, {
        count: 1,
        firstAttempt: now,
      });
    } else if ((now - ipAttempt.firstAttempt) > this.WINDOW_MS) {
      // Reset if outside window
      this.ipAttempts.set(ip, {
        count: 1,
        firstAttempt: now,
      });
    } else {
      ipAttempt.count++;
      if (ipAttempt.count >= this.MAX_ATTEMPTS) {
        ipAttempt.lockedUntil = now + this.LOCKOUT_MS;
      }
    }

    // Record username attempt if provided
    if (username) {
      const userAttempt = this.usernameAttempts.get(username);
      if (!userAttempt) {
        this.usernameAttempts.set(username, {
          count: 1,
          firstAttempt: now,
        });
      } else if ((now - userAttempt.firstAttempt) > this.WINDOW_MS) {
        // Reset if outside window
        this.usernameAttempts.set(username, {
          count: 1,
          firstAttempt: now,
        });
      } else {
        userAttempt.count++;
        if (userAttempt.count >= this.MAX_ATTEMPTS) {
          userAttempt.lockedUntil = now + this.LOCKOUT_MS;
        }
      }
    }
  }

  resetAttempts(ip: string, username?: string): void {
    this.ipAttempts.delete(ip);
    if (username) {
      this.usernameAttempts.delete(username);
    }
  }

  isLocked(ip: string, username?: string): { locked: boolean; remainingTime?: number } {
    const now = Date.now();

    // Check IP lockout
    const ipAttempt = this.ipAttempts.get(ip);
    if (ipAttempt?.lockedUntil && ipAttempt.lockedUntil > now) {
      return {
        locked: true,
        remainingTime: Math.ceil((ipAttempt.lockedUntil - now) / 1000),
      };
    }

    // Check username lockout
    if (username) {
      const userAttempt = this.usernameAttempts.get(username);
      if (userAttempt?.lockedUntil && userAttempt.lockedUntil > now) {
        return {
          locked: true,
          remainingTime: Math.ceil((userAttempt.lockedUntil - now) / 1000),
        };
      }
    }

    return { locked: false };
  }

  getRemainingAttempts(ip: string, username?: string): number {
    const now = Date.now();
    let minRemaining = this.MAX_ATTEMPTS;

    // Check IP attempts
    const ipAttempt = this.ipAttempts.get(ip);
    if (ipAttempt && (now - ipAttempt.firstAttempt) <= this.WINDOW_MS) {
      const ipRemaining = Math.max(0, this.MAX_ATTEMPTS - ipAttempt.count);
      minRemaining = Math.min(minRemaining, ipRemaining);
    }

    // Check username attempts
    if (username) {
      const userAttempt = this.usernameAttempts.get(username);
      if (userAttempt && (now - userAttempt.firstAttempt) <= this.WINDOW_MS) {
        const userRemaining = Math.max(0, this.MAX_ATTEMPTS - userAttempt.count);
        minRemaining = Math.min(minRemaining, userRemaining);
      }
    }

    return minRemaining;
  }
}

// Export singleton instance
export const loginRateLimiter = new LoginRateLimiter();
