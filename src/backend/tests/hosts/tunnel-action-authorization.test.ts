import { beforeEach, describe, expect, it, vi } from "vitest";

const canAccessHost = vi.hoisted(() => vi.fn());
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: { getInstance: () => ({ canAccessHost }) },
}));

/**
 * /ssh/tunnel/disconnect and /ssh/tunnel/cancel are addressed by tunnel NAME.
 * Their ownership check used to run only inside
 * `if (config && config.sourceHostId)`, and web endpoint tunnels are
 * deliberately kept out of tunnelConfigs -- so `config` was always undefined
 * for them and the check never ran.
 *
 * Host ids are small sequential integers and endpoint ids are client-supplied
 * with no server-side randomness, so `web:{hostId}:{endpointId}` is guessable.
 * That let any authenticated user force-close another user's live tunnel, and
 * manualDisconnects then made the victim's own re-open fail for several
 * seconds.
 */
describe("authorizeTunnelAction", () => {
  beforeEach(() => {
    canAccessHost.mockReset();
  });

  it("checks the host encoded in a reserved name when no config exists", async () => {
    canAccessHost.mockResolvedValue({ hasAccess: true });
    const { authorizeTunnelAction } =
      await import("../../hosts/tunnel/routes.js");

    const result = await authorizeTunnelAction("u1", "web:7:e1", undefined);

    expect(result.allowed).toBe(true);
    expect(canAccessHost).toHaveBeenCalledWith("u1", 7, "connect");
  });

  it("denies a reserved name whose host the user cannot access", async () => {
    canAccessHost.mockResolvedValue({ hasAccess: false });
    const { authorizeTunnelAction } =
      await import("../../hosts/tunnel/routes.js");

    expect(
      (await authorizeTunnelAction("u1", "web:7:e1", undefined)).allowed,
    ).toBe(false);
  });

  it("fails closed on a reserved name it cannot parse", async () => {
    // Never fall through to the unchecked path: an unparseable reserved name
    // means "cannot verify ownership", which must deny.
    const { authorizeTunnelAction } =
      await import("../../hosts/tunnel/routes.js");

    for (const name of ["web:", "web:abc:e1", "web:0:e1"]) {
      expect((await authorizeTunnelAction("u1", name, undefined)).allowed).toBe(
        false,
      );
    }
    expect(canAccessHost).not.toHaveBeenCalled();
  });

  it("still checks a registered config's host id", async () => {
    canAccessHost.mockResolvedValue({ hasAccess: true });
    const { authorizeTunnelAction } =
      await import("../../hosts/tunnel/routes.js");

    await authorizeTunnelAction("u1", "my-tunnel", { sourceHostId: 42 });
    expect(canAccessHost).toHaveBeenCalledWith("u1", 42, "connect");
  });

  it("leaves an ordinary unregistered name allowed, as before", async () => {
    // Pre-existing behaviour for non-reserved names, preserved deliberately:
    // tightening it is a separate change with its own blast radius.
    const { authorizeTunnelAction } =
      await import("../../hosts/tunnel/routes.js");

    expect(
      (await authorizeTunnelAction("u1", "my-tunnel", undefined)).allowed,
    ).toBe(true);
    expect(canAccessHost).not.toHaveBeenCalled();
  });
});
