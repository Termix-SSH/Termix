import { describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({ createAdminMiddleware: vi.fn() }),
  },
}));

const { isValidOidcIssuer } =
  await import("../../../database/routes/sso-provider-routes.js");

describe("isValidOidcIssuer", () => {
  it("rejects userinfo endpoints used as issuer URLs", () => {
    expect(
      isValidOidcIssuer("https://auth.example/application/o/userinfo/"),
    ).toBe(false);
  });

  it("accepts an Authentik application issuer", () => {
    expect(isValidOidcIssuer("https://auth.example/application/o/termix")).toBe(
      true,
    );
  });
});
