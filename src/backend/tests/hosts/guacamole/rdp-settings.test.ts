import { describe, expect, it } from "vitest";
import {
  buildRdpSettings,
  resolveRdpAuthTypeForConnect,
  resolveRdpDomain,
} from "../../../hosts/guacamole/rdp-settings.js";

describe("buildRdpSettings", () => {
  it("keeps saved RDP settings authoritative over stale advanced config", () => {
    expect(
      buildRdpSettings({
        port: 3390,
        domain: "EXAMPLE",
        security: "nla",
        ignoreCert: true,
        guacConfig: {
          port: 3389,
          domain: "OLD",
          security: "rdp",
          "ignore-cert": false,
          "color-depth": 24,
        },
        guacdOverrides: { guacdHost: "guacd.internal" },
      }),
    ).toEqual({
      port: 3390,
      domain: "EXAMPLE",
      security: "nla",
      "ignore-cert": true,
      "color-depth": 24,
      guacdHost: "guacd.internal",
    });
  });

  it("preserves an advanced security value when no saved value exists", () => {
    expect(
      buildRdpSettings({
        port: 3389,
        ignoreCert: false,
        guacConfig: { security: "tls" },
        guacdOverrides: {},
      }).security,
    ).toBe("tls");
  });

  it("uses the prompted domain for prompt-on-connect authentication", () => {
    expect(resolveRdpDomain("none", "EXAMPLE", "OLD")).toBe("EXAMPLE");
    expect(resolveRdpDomain("none", "", "OLD")).toBe("");
  });

  it("keeps the stored domain for saved authentication", () => {
    expect(resolveRdpDomain("direct", "EXAMPLE", "SAVED")).toBe("SAVED");
    expect(resolveRdpDomain("none", undefined, "SAVED")).toBe("SAVED");
  });
});

describe("resolveRdpAuthTypeForConnect", () => {
  it("keeps prompt-on-connect authentication for a secretless recipient", () => {
    expect(
      resolveRdpAuthTypeForConnect({
        storedAuthType: "none",
        sharedResolution: { source: "secretless" },
      }),
    ).toBe("none");
  });

  it("uses a recipient override instead of prompting", () => {
    expect(
      resolveRdpAuthTypeForConnect({
        storedAuthType: "none",
        sharedResolution: { source: "personal-override" },
      }),
    ).toBe("credential");
  });

  it("uses authentication shared by the owner", () => {
    expect(
      resolveRdpAuthTypeForConnect({
        storedAuthType: "credential",
        sharedResolution: { source: "owner-shared", authType: "credential" },
      }),
    ).toBe("credential");
  });
});
