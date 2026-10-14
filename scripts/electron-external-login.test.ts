import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isExternalLoginUrl, isCallbackPort } =
  require("../electron/external-login.cjs") as {
    isExternalLoginUrl: (value: unknown) => boolean;
    isCallbackPort: (value: unknown) => boolean;
  };

describe("Electron external login", () => {
  it.each([
    "https://idp.example.com/authorize?client_id=termix",
    "http://keycloak.lan:8080/realms/home/protocol/openid-connect/auth",
  ])("opens web login URLs: %s", (url) => {
    expect(isExternalLoginUrl(url)).toBe(true);
  });

  it.each([
    "file:///C:/Windows/System32/calc.exe",
    "smb://attacker/share",
    "ms-msdt:/id PCWDiagnostic",
    "javascript:alert(1)",
    "not a url",
    undefined,
  ])("refuses other schemes: %s", (url) => {
    expect(isExternalLoginUrl(url)).toBe(false);
  });

  it("accepts the ports the login screen picks", () => {
    expect(isCallbackPort(17832)).toBe(true);
    expect(isCallbackPort(17931)).toBe(true);
  });

  it.each([0, 80, 65536, 17832.5, "17832", NaN, undefined])(
    "refuses callback port %s",
    (port) => {
      expect(isCallbackPort(port)).toBe(false);
    },
  );
});
