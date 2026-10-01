import { describe, expect, it } from "vitest";
import { validateManifest } from "@termix/plugin-sdk/manifest";
import manifest from "../../manifest.json";

// Old URLs something outside Termix still calls keep reaching the plugin.
const redirects = manifest.contributes.http.legacyRedirects as unknown[];

describe("legacy URLs", () => {
  it("declares them in a manifest that validates", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("redirects /vault/oidc/callback, which Vault OIDC roles allowed before 2.9", () => {
    expect(redirects).toContainEqual({
      from: "/vault/oidc/callback",
      to: "/oidc/callback",
    });
  });
});
