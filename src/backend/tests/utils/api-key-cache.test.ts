/**
 * API key verification cache: a repeat request skips bcrypt, but only while
 * the same key is still active and unchanged.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  cachedApiKeyMatch,
  clearApiKeyCache,
  rememberApiKeyMatch,
} from "../../utils/api-key-cache.js";

const key = { id: "k1", tokenHash: "$2b$10$hash" };
const token = "tmx_abcdef0123456789";

describe("api key cache", () => {
  beforeEach(() => clearApiKeyCache());

  it("finds a key this token already matched", () => {
    rememberApiKeyMatch(token, key);
    expect(cachedApiKeyMatch(token, [key])).toBe(key);
  });

  it("misses for a token it never saw", () => {
    rememberApiKeyMatch(token, key);
    expect(cachedApiKeyMatch("tmx_other", [key])).toBeNull();
  });

  it("misses once the key is revoked (no longer a candidate)", () => {
    rememberApiKeyMatch(token, key);
    expect(cachedApiKeyMatch(token, [])).toBeNull();
    // And stays gone even if the key came back.
    expect(cachedApiKeyMatch(token, [key])).toBeNull();
  });

  it("misses when the stored hash changed", () => {
    rememberApiKeyMatch(token, key);
    expect(
      cachedApiKeyMatch(token, [{ id: "k1", tokenHash: "$2b$10$new" }]),
    ).toBeNull();
  });

  it("forgets entries after their time is up", () => {
    rememberApiKeyMatch(token, key, 0);
    expect(cachedApiKeyMatch(token, [key], 6 * 60 * 1000)).toBeNull();
  });
});
