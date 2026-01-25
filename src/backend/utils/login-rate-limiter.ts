interface LoginAttempt {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}

class LoginRateLimiter {
  private ipAttempts = new Map<string, LoginAttempt>();
  private usernameAttempts = new Map<string, LoginAttempt>();
  private totpAttempts = new Map<string, LoginAttempt>();
  private resetCodeAttempts = new Map<string, LoginAttempt>();

  private readonly MAX_ATTEMPTS = 5;
  private readonly WINDOW_MS = 10 * 60 * 1000;
  private readonly LOCKOUT_MS = 10 * 60 * 1000;

  private readonly TOTP_MAX_ATTEMPTS = 5;
  private readonly TOTP_WINDOW_MS = 1 * 60 * 1000;
  private readonly TOTP_LOCKOUT_MS = 5 * 60 * 1000;

  private readonly RESET_CODE_MAX_ATTEMPTS = 5;
  private readonly RESET_CODE_WINDOW_MS = 1 * 60 * 1000;
  private readonly RESET_CODE_LOCKOUT_MS = 5 * 60 * 1000;

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private cleanup(): void {
    const now = Date.now();

    for (const [ip, attempt] of this.ipAttempts.entries()) {
      if (attempt.lockedUntil && attempt.lockedUntil < now) {
        this.ipAttempts.delete(ip);
      } else if (
        !attempt.lockedUntil &&
        now - attempt.firstAttempt > this.WINDOW_MS
      ) {
        this.ipAttempts.delete(ip);
      }
    }

    for (const [username, attempt] of this.usernameAttempts.entries()) {
      if (attempt.lockedUntil && attempt.lockedUntil < now) {
        this.usernameAttempts.delete(username);
      } else if (
        !attempt.lockedUntil &&
        now - attempt.firstAttempt > this.WINDOW_MS
      ) {
        this.usernameAttempts.delete(username);
      }
    }

    for (const [userId, attempt] of this.totpAttempts.entries()) {
      if (attempt.lockedUntil && attempt.lockedUntil < now) {
        this.totpAttempts.delete(userId);
      } else if (
        !attempt.lockedUntil &&
        now - attempt.firstAttempt > this.TOTP_WINDOW_MS
      ) {
        this.totpAttempts.delete(userId);
      }
    }

    for (const [username, attempt] of this.resetCodeAttempts.entries()) {
      if (attempt.lockedUntil && attempt.lockedUntil < now) {
        this.resetCodeAttempts.delete(username);
      } else if (
        !attempt.lockedUntil &&
        now - attempt.firstAttempt > this.RESET_CODE_WINDOW_MS
      ) {
        this.resetCodeAttempts.delete(username);
      }
    }
  }

  recordFailedAttempt(ip: string, username?: string): void {
    const now = Date.now();

    const ipAttempt = this.ipAttempts.get(ip);
    if (!ipAttempt) {
      this.ipAttempts.set(ip, {
        count: 1,
        firstAttempt: now,
      });
    } else if (now - ipAttempt.firstAttempt > this.WINDOW_MS) {
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

    if (username) {
      const userAttempt = this.usernameAttempts.get(username);
      if (!userAttempt) {
        this.usernameAttempts.set(username, {
          count: 1,
          firstAttempt: now,
        });
      } else if (now - userAttempt.firstAttempt > this.WINDOW_MS) {
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

  isLocked(
    ip: string,
    username?: string,
  ): { locked: boolean; remainingTime?: number } {
    const now = Date.now();

    const ipAttempt = this.ipAttempts.get(ip);
    if (ipAttempt?.lockedUntil && ipAttempt.lockedUntil > now) {
      return {
        locked: true,
        remainingTime: Math.ceil((ipAttempt.lockedUntil - now) / 1000),
      };
    }

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

    const ipAttempt = this.ipAttempts.get(ip);
    if (ipAttempt && now - ipAttempt.firstAttempt <= this.WINDOW_MS) {
      const ipRemaining = Math.max(0, this.MAX_ATTEMPTS - ipAttempt.count);
      minRemaining = Math.min(minRemaining, ipRemaining);
    }

    if (username) {
      const userAttempt = this.usernameAttempts.get(username);
      if (userAttempt && now - userAttempt.firstAttempt <= this.WINDOW_MS) {
        const userRemaining = Math.max(
          0,
          this.MAX_ATTEMPTS - userAttempt.count,
        );
        minRemaining = Math.min(minRemaining, userRemaining);
      }
    }

    return minRemaining;
  }

  recordFailedTOTPAttempt(userId: string): void {
    const now = Date.now();

    const totpAttempt = this.totpAttempts.get(userId);
    if (!totpAttempt) {
      this.totpAttempts.set(userId, {
        count: 1,
        firstAttempt: now,
      });
    } else if (now - totpAttempt.firstAttempt > this.TOTP_WINDOW_MS) {
      this.totpAttempts.set(userId, {
        count: 1,
        firstAttempt: now,
      });
    } else {
      totpAttempt.count++;
      if (totpAttempt.count >= this.TOTP_MAX_ATTEMPTS) {
        totpAttempt.lockedUntil = now + this.TOTP_LOCKOUT_MS;
      }
    }
  }

  resetTOTPAttempts(userId: string): void {
    this.totpAttempts.delete(userId);
  }

  isTOTPLocked(userId: string): { locked: boolean; remainingTime?: number } {
    const now = Date.now();

    const totpAttempt = this.totpAttempts.get(userId);
    if (totpAttempt?.lockedUntil && totpAttempt.lockedUntil > now) {
      return {
        locked: true,
        remainingTime: Math.ceil((totpAttempt.lockedUntil - now) / 1000),
      };
    }

    return { locked: false };
  }

  getRemainingTOTPAttempts(userId: string): number {
    const now = Date.now();

    const totpAttempt = this.totpAttempts.get(userId);
    if (totpAttempt && now - totpAttempt.firstAttempt <= this.TOTP_WINDOW_MS) {
      return Math.max(0, this.TOTP_MAX_ATTEMPTS - totpAttempt.count);
    }

    return this.TOTP_MAX_ATTEMPTS;
  }

  recordResetCodeAttempt(username: string): void {
    const now = Date.now();

    const resetAttempt = this.resetCodeAttempts.get(username);
    if (!resetAttempt) {
      this.resetCodeAttempts.set(username, {
        count: 1,
        firstAttempt: now,
      });
    } else if (now - resetAttempt.firstAttempt > this.RESET_CODE_WINDOW_MS) {
      this.resetCodeAttempts.set(username, {
        count: 1,
        firstAttempt: now,
      });
    } else {
      resetAttempt.count++;
      if (resetAttempt.count >= this.RESET_CODE_MAX_ATTEMPTS) {
        resetAttempt.lockedUntil = now + this.RESET_CODE_LOCKOUT_MS;
      }
    }
  }

  resetResetCodeAttempts(username: string): void {
    this.resetCodeAttempts.delete(username);
  }

  isResetCodeLocked(username: string): {
    locked: boolean;
    remainingTime?: number;
  } {
    const now = Date.now();

    const resetAttempt = this.resetCodeAttempts.get(username);
    if (resetAttempt?.lockedUntil && resetAttempt.lockedUntil > now) {
      return {
        locked: true,
        remainingTime: Math.ceil((resetAttempt.lockedUntil - now) / 1000),
      };
    }

    return { locked: false };
  }

  getRemainingResetCodeAttempts(username: string): number {
    const now = Date.now();

    const resetAttempt = this.resetCodeAttempts.get(username);
    if (
      resetAttempt &&
      now - resetAttempt.firstAttempt <= this.RESET_CODE_WINDOW_MS
    ) {
      return Math.max(0, this.RESET_CODE_MAX_ATTEMPTS - resetAttempt.count);
    }

    return this.RESET_CODE_MAX_ATTEMPTS;
  }
}

export const loginRateLimiter = new LoginRateLimiter();
