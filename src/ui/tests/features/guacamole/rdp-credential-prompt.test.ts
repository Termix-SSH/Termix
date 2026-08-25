import { describe, expect, it } from "vitest";
import { needsRdpCredentialPrompt } from "@/features/guacamole/rdp-credential-prompt";

describe("needsRdpCredentialPrompt", () => {
  it("prompts recipients when RDP has no saved authentication", () => {
    expect(
      needsRdpCredentialPrompt({ protocol: "rdp", rdpAuthType: "none" }),
    ).toBe(true);
  });

  it("does not prompt when the recipient has a personal override", () => {
    expect(
      needsRdpCredentialPrompt({
        protocol: "rdp",
        rdpAuthType: "none",
        authOverrides: {
          rdp: { credentialId: 7, required: false, ownerAuthShared: true },
        },
      }),
    ).toBe(false);
  });

  it("does not prompt for other protocols", () => {
    expect(
      needsRdpCredentialPrompt({ protocol: "vnc", rdpAuthType: "none" }),
    ).toBe(false);
  });
});
