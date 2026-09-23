import { describe, expect, it, vi } from "vitest";
import { authorizeTunnelAction } from "../../src/backend/authorize.js";

/**
 * /disconnect and /cancel are addressed by tunnel name. On-demand tunnels are
 * never registered as configs, so a check that only ran for a registered
 * config never ran for them, and `web:{hostId}:{endpointId}` is guessable.
 * That let any user force-close another user's live tunnel.
 */
describe("authorizeTunnelAction", () => {
  it("checks the host encoded in a reserved name when no config exists", async () => {
    const canAccess = vi.fn().mockResolvedValue(true);
    const result = await authorizeTunnelAction(
      canAccess,
      "web:7:e1",
      undefined,
    );

    expect(result).toEqual({ allowed: true, hostId: 7 });
    expect(canAccess).toHaveBeenCalledWith(7);
  });

  it("denies a reserved name whose host the user cannot access", async () => {
    const canAccess = vi.fn().mockResolvedValue(false);
    expect(
      (await authorizeTunnelAction(canAccess, "web:7:e1", undefined)).allowed,
    ).toBe(false);
  });

  it("fails closed on a reserved name it cannot parse", async () => {
    const canAccess = vi.fn().mockResolvedValue(true);
    for (const name of ["web:", "web:abc:e1", "web:0:e1"]) {
      expect(
        (await authorizeTunnelAction(canAccess, name, undefined)).allowed,
      ).toBe(false);
    }
    expect(canAccess).not.toHaveBeenCalled();
  });

  it("still checks a registered config's host id", async () => {
    const canAccess = vi.fn().mockResolvedValue(true);
    await authorizeTunnelAction(canAccess, "my-tunnel", { sourceHostId: 42 });
    expect(canAccess).toHaveBeenCalledWith(42);
  });

  it("leaves an ordinary unregistered name allowed", async () => {
    const canAccess = vi.fn();
    expect(
      (await authorizeTunnelAction(canAccess, "my-tunnel", undefined)).allowed,
    ).toBe(true);
    expect(canAccess).not.toHaveBeenCalled();
  });
});
