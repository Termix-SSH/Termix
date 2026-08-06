import { describe, it, expect } from "vitest";
import {
  parseTailscaleCheckBanner,
  isTailscaleCheckCompleteBanner,
} from "../../hosts/tailscale-check.js";

describe("parseTailscaleCheckBanner", () => {
  it("extracts the login URL from a real check-mode banner", () => {
    const banner =
      "# Tailscale SSH requires an additional check.\n# To authenticate, visit: https://login.tailscale.com/a/lefcb2f3377403\n";

    const result = parseTailscaleCheckBanner(banner);

    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://login.tailscale.com/a/lefcb2f3377403");
  });

  it("strips comment markers from the message it returns", () => {
    const banner =
      "# Tailscale SSH requires an additional check.\n# To authenticate, visit: https://login.tailscale.com/a/abc123\n";

    const result = parseTailscaleCheckBanner(banner);

    expect(result?.message).toBe(
      "Tailscale SSH requires an additional check.\nTo authenticate, visit: https://login.tailscale.com/a/abc123",
    );
  });

  it("returns null for an ordinary MOTD banner", () => {
    const banner =
      "Welcome to Ubuntu 24.04 LTS\nLast login: Tue Aug 5 09:12:03 2026\n";

    expect(parseTailscaleCheckBanner(banner)).toBeNull();
  });

  it("returns null for a lookalike URL on another host", () => {
    const banner =
      "# To authenticate, visit: https://login.tailscale.com.evil.example/a/abc123\n";

    expect(parseTailscaleCheckBanner(banner)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseTailscaleCheckBanner("")).toBeNull();
  });
});

describe("isTailscaleCheckCompleteBanner", () => {
  it("recognises the completion banner", () => {
    expect(
      isTailscaleCheckCompleteBanner(
        "# Authentication checked with Tailscale SSH.",
      ),
    ).toBe(true);
  });

  it("recognises the completion banner with a time suffix", () => {
    expect(
      isTailscaleCheckCompleteBanner(
        "Authentication checked with Tailscale SSH. Time since last authentication: 0s",
      ),
    ).toBe(true);
  });

  it("does not match the check-required banner", () => {
    expect(
      isTailscaleCheckCompleteBanner(
        "# Tailscale SSH requires an additional check.",
      ),
    ).toBe(false);
  });

  it("does not match empty input", () => {
    expect(isTailscaleCheckCompleteBanner("")).toBe(false);
  });
});
