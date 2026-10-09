import { describe, expect, it } from "vitest";
import { isLoginRequestUrl } from "@/main-axios";

describe("isLoginRequestUrl", () => {
  it("knows every sign in request", () => {
    expect(isLoginRequestUrl("/users/login")).toBe(true);
    expect(isLoginRequestUrl("/users/totp/verify-login")).toBe(true);
    expect(isLoginRequestUrl("/users/auth/ldap/verify")).toBe(true);
    expect(isLoginRequestUrl("/users/auth/second-factor/totp/verify")).toBe(
      true,
    );
  });

  it("leaves other requests alone", () => {
    expect(isLoginRequestUrl("/host/db/host")).toBe(false);
    expect(isLoginRequestUrl("/users/auth/ldap/start")).toBe(false);
    expect(isLoginRequestUrl(undefined)).toBe(false);
  });
});
