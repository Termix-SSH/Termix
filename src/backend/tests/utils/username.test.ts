import { describe, expect, it } from "vitest";
import { isAcceptableUsername } from "../../utils/username.js";

describe("isAcceptableUsername", () => {
  it.each(["alice", "bob.smith", "user@example.com", "Jöran", "a b"])(
    "accepts %j",
    (name) => expect(isAcceptableUsername(name)).toBe(true),
  );

  it.each(["../../etc/x", "a\\b", "a/b", "nul\u0000", "tab\t", "x".repeat(65)])(
    "refuses %j",
    (name) => expect(isAcceptableUsername(name)).toBe(false),
  );
});
