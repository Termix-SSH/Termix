import { describe, it, expect, beforeEach } from "vitest";
import { loginRateLimiter } from "./login-rate-limiter.js";

// The limiter is a shared singleton, so each test uses unique ip/username keys
// and resets them to stay isolated.
describe("loginRateLimiter login attempts", () => {
  let ip: string;
  let username: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    ip = `10.0.0.${counter}`;
    username = `user${counter}`;
    loginRateLimiter.resetAttempts(ip, username);
  });

  it("starts unlocked with the full attempt budget", () => {
    expect(loginRateLimiter.isLocked(ip, username).locked).toBe(false);
    expect(loginRateLimiter.getRemainingAttempts(ip, username)).toBe(5);
  });

  it("decrements remaining attempts on each failure", () => {
    loginRateLimiter.recordFailedAttempt(ip, username);
    expect(loginRateLimiter.getRemainingAttempts(ip, username)).toBe(4);
    loginRateLimiter.recordFailedAttempt(ip, username);
    expect(loginRateLimiter.getRemainingAttempts(ip, username)).toBe(3);
  });

  it("locks the account after 5 failed attempts", () => {
    for (let i = 0; i < 5; i++) {
      loginRateLimiter.recordFailedAttempt(ip, username);
    }
    const result = loginRateLimiter.isLocked(ip, username);
    expect(result.locked).toBe(true);
    expect(result.remainingTime).toBeGreaterThan(0);
    expect(loginRateLimiter.getRemainingAttempts(ip, username)).toBe(0);
  });

  it("clears the lock and counters on reset (successful login)", () => {
    for (let i = 0; i < 5; i++) {
      loginRateLimiter.recordFailedAttempt(ip, username);
    }
    expect(loginRateLimiter.isLocked(ip, username).locked).toBe(true);

    loginRateLimiter.resetAttempts(ip, username);
    expect(loginRateLimiter.isLocked(ip, username).locked).toBe(false);
    expect(loginRateLimiter.getRemainingAttempts(ip, username)).toBe(5);
  });

  it("locks by IP even without a username", () => {
    const soloIp = `192.168.1.${counter}`;
    for (let i = 0; i < 5; i++) {
      loginRateLimiter.recordFailedAttempt(soloIp);
    }
    expect(loginRateLimiter.isLocked(soloIp).locked).toBe(true);
    loginRateLimiter.resetAttempts(soloIp);
  });
});

describe("loginRateLimiter TOTP attempts", () => {
  let userId: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    userId = `totp-user${counter}`;
    loginRateLimiter.resetTOTPAttempts(userId);
  });

  it("locks TOTP after 5 failures and resets cleanly", () => {
    expect(loginRateLimiter.isTOTPLocked(userId).locked).toBe(false);
    for (let i = 0; i < 5; i++) {
      loginRateLimiter.recordFailedTOTPAttempt(userId);
    }
    expect(loginRateLimiter.isTOTPLocked(userId).locked).toBe(true);
    expect(loginRateLimiter.getRemainingTOTPAttempts(userId)).toBe(0);

    loginRateLimiter.resetTOTPAttempts(userId);
    expect(loginRateLimiter.isTOTPLocked(userId).locked).toBe(false);
    expect(loginRateLimiter.getRemainingTOTPAttempts(userId)).toBe(5);
  });
});

describe("loginRateLimiter password-reset-code attempts", () => {
  let username: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    username = `reset-user${counter}`;
    loginRateLimiter.resetResetCodeAttempts(username);
  });

  it("locks reset codes after 5 failures and resets cleanly", () => {
    expect(loginRateLimiter.isResetCodeLocked(username).locked).toBe(false);
    for (let i = 0; i < 5; i++) {
      loginRateLimiter.recordResetCodeAttempt(username);
    }
    expect(loginRateLimiter.isResetCodeLocked(username).locked).toBe(true);

    loginRateLimiter.resetResetCodeAttempts(username);
    expect(loginRateLimiter.isResetCodeLocked(username).locked).toBe(false);
  });
});
