import { describe, expect, it } from "vitest";
import { resolveSshKeepalive } from "./ssh-keepalive.js";

describe("resolveSshKeepalive", () => {
  it("preserves zero to disable SSH keepalives", () => {
    expect(resolveSshKeepalive(0, 0, 30000, 5)).toEqual({
      keepaliveInterval: 0,
      keepaliveCountMax: 0,
    });
  });

  it("uses defaults when keepalive settings are absent", () => {
    expect(resolveSshKeepalive(undefined, undefined, 60000, 5)).toEqual({
      keepaliveInterval: 60000,
      keepaliveCountMax: 5,
    });
  });

  it("enforces the existing minimums for positive settings", () => {
    expect(resolveSshKeepalive(1, 0.5, 30000, 5)).toEqual({
      keepaliveInterval: 5000,
      keepaliveCountMax: 1,
    });
  });
});
