import { describe, expect, it } from "vitest";
import {
  getDesktopOidcCallbackUrl,
  isOidcTokenCallback,
} from "./oidc-desktop-callback";

describe("getDesktopOidcCallbackUrl", () => {
  it("uses localhost so browsers do not upgrade the loopback callback", () => {
    expect(getDesktopOidcCallbackUrl("17850")).toBe(
      "http://localhost:17850/oidc-callback",
    );
  });

  it.each(["", "0", "65536", "17850/path", ["17850"]])(
    "rejects invalid callback port %j",
    (port) => {
      expect(getDesktopOidcCallbackUrl(port)).toBeNull();
    },
  );
});

describe("isOidcTokenCallback", () => {
  it.each([
    "http://localhost:17850/oidc-callback",
    "http://127.0.0.1:17850/oidc-callback",
    "termix-mobile://oidc-callback",
  ])("recognizes app callback %s", (url) => {
    expect(isOidcTokenCallback(url)).toBe(true);
  });

  it.each([
    "https://localhost:17850/oidc-callback",
    "http://example.com:17850/oidc-callback",
    "http://localhost:17850/other",
  ])("rejects non-app callback %s", (url) => {
    expect(isOidcTokenCallback(url)).toBe(false);
  });
});
