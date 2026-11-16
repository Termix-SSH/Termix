import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isLocalBackendUrl } = require("../../../../electron/local-backend.cjs");

describe("isLocalBackendUrl", () => {
  it("matches only this app's backend on loopback", () => {
    expect(isLocalBackendUrl("http://127.0.0.1:30001/users/me", 30001)).toBe(
      true,
    );
    expect(isLocalBackendUrl("http://localhost:30001/x", 30001)).toBe(true);
    expect(isLocalBackendUrl("http://127.0.0.1:30002/x", 30001)).toBe(false);
    expect(isLocalBackendUrl("https://termix.example.com/x", 30001)).toBe(
      false,
    );
    expect(
      isLocalBackendUrl("http://127.0.0.1.evil.example:30001/", 30001),
    ).toBe(false);
    expect(isLocalBackendUrl("not a url", 30001)).toBe(false);
  });
});
