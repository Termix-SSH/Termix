import { describe, expect, it } from "vitest";
import {
  BRANDING_LOGO_MAX_BYTES,
  isAcceptedBrandingLogoFile,
} from "../../sidebar/branding-logo-file.js";

describe("branding logo file", () => {
  it("rejects types the file input accept attribute cannot enforce", () => {
    expect(
      isAcceptedBrandingLogoFile({ type: "image/svg+xml", size: 12 }),
    ).toBe(false);
    expect(isAcceptedBrandingLogoFile({ type: "text/plain", size: 12 })).toBe(
      false,
    );
    expect(isAcceptedBrandingLogoFile({ type: "image/png", size: 12 })).toBe(
      true,
    );
  });

  it("rejects oversized uploads before they are read into settings", () => {
    expect(
      isAcceptedBrandingLogoFile({
        type: "image/png",
        size: BRANDING_LOGO_MAX_BYTES + 1,
      }),
    ).toBe(false);
  });
});
