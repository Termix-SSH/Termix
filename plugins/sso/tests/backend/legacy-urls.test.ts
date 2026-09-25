import { describe, expect, it } from "vitest";
import { validateManifest } from "@termix/plugin-sdk/manifest";
import manifest from "../../manifest.json";

// Old URLs something outside Termix still calls keep reaching the plugin.
const redirects = manifest.contributes.http.legacyRedirects as unknown[];

describe("legacy URLs", () => {
  it("declares them in a manifest that validates", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("redirects /users/oidc-config, which 2.8 clients read", () => {
    expect(redirects).toContainEqual({
      from: "/users/oidc-config",
      to: "/config",
    });
  });

  it("redirects /users/oidc/callback, which identity providers were set up with before 2.9", () => {
    expect(redirects).toContainEqual({
      from: "/users/oidc/callback",
      to: "/callback",
      status: 308,
    });
  });

  it("redirects /users/oidc/backchannel-logout, which identity providers send back-channel logouts to", () => {
    expect(redirects).toContainEqual({
      from: "/users/oidc/backchannel-logout",
      to: "/backchannel-logout",
      status: 308,
    });
  });
});
