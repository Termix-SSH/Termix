import { describe, expect, it } from "vitest";
import { isOidcTokenCallback } from "../../utils/oidc-desktop-callback.js";

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
