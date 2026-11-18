/**
 * A session that must set up a second factor first reaches only what the
 * setup screen needs: reads of the plugin list and look, who am I, sign out,
 * the login routes and the second factor plugins. Never plugin management.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../../auth/registry.js", () => ({
  listSecondFactors: () => [{ pluginId: "keys" }],
}));

const { sessionAccessRefusal } = await import("../../auth/session-access.js");

const setup = { restriction: "second-factor-setup" };

const refused = (method: string, path: string) =>
  !!sessionAccessRefusal(setup, path, method);

describe("GHSA-v72h-7vx3-qqgr setup sessions can't manage plugins", () => {
  it.each([
    ["POST", "/plugins/update-all"],
    ["POST", "/plugins/upload"],
    ["POST", "/plugins/upload/abc/install"],
    ["POST", "/plugins/keys/install"],
    ["POST", "/plugins/keys/update"],
    ["POST", "/plugins/keys/restore-bundled"],
    ["DELETE", "/plugins/keys"],
    ["PATCH", "/plugins/keys/state"],
    ["POST", "/plugins/keys/grants"],
    ["DELETE", "/plugins/keys/data"],
    ["PUT", "/plugins/keys/settings/admin"],
    ["GET", "/plugins/keys/settings/admin"],
    ["GET", "/plugins/keys/data"],
    ["GET", "/plugins/registries"],
    ["POST", "/plugins/registries"],
    ["GET", "/plugins/registry"],
    ["GET", "/plugins/developer-mode"],
    ["PUT", "/plugins/developer-mode"],
    ["GET", "/plugins/onboarding"],
    ["POST", "/plugins/onboarding/apply"],
    ["POST", "/plugins/channel"],
    ["PUT", "/user-preferences/look/defaults"],
    ["PUT", "/user-preferences/look"],
  ])("refuses %s %s", (method, path) => {
    expect(refused(method, path)).toBe(true);
  });

  it.each([
    ["GET", "/plugins"],
    ["GET", "/plugins/public"],
    ["GET", "/plugins/public-manifest"],
    ["GET", "/plugins/keys/settings/user"],
    ["GET", "/user-preferences/look"],
    ["GET", "/users/me"],
    ["POST", "/users/logout"],
    ["GET", "/users/auth/step-up/factors"],
    ["GET", "/plugin-assets/keys/frontend.js"],
    ["POST", "/plugin-api/keys/setup"],
    ["GET", "/plugin-ws/keys/live"],
  ])("allows %s %s", (method, path) => {
    expect(refused(method, path)).toBe(false);
  });

  it("treats a missing method as a read, which is what a socket upgrade is", () => {
    expect(!!sessionAccessRefusal(setup, "/plugins")).toBe(false);
    expect(!!sessionAccessRefusal(setup, "/plugins/update-all")).toBe(true);
  });
});
