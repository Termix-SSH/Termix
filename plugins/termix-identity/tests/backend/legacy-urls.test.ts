import { describe, expect, it } from "vitest";
import { validateManifest } from "@termix/plugin-sdk/manifest";
import manifest from "../../manifest.json";

// Old URLs something outside Termix still calls keep reaching the plugin.
const redirects = manifest.contributes.http.legacyRedirects as unknown[];

describe("legacy URLs", () => {
  it("declares them in a manifest that validates", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("redirects /termix-id/u, which servers provisioned with a 2.8 Termix ID resolver URL fetch", () => {
    expect(redirects).toContainEqual({
      from: "/termix-id/u",
      to: "/u",
      status: 308,
    });
  });
});
