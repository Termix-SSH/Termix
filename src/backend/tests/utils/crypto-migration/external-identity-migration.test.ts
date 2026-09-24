import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthState,
  type AuthState,
} from "../../auth/auth-test-helpers.js";

const h = vi.hoisted(() => ({ state: null as unknown as AuthState }));

vi.mock("../../../database/repositories/factory.js", async () => {
  const helpers = await import("../../auth/auth-test-helpers.js");
  const names = Object.keys(helpers.fakeFactory(helpers.createAuthState()));
  return Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]) =>
        (
          helpers.fakeFactory(h.state) as Record<
            string,
            (...a: unknown[]) => unknown
          >
        )[name](...args),
    ]),
  );
});
vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { runExternalIdentityMigration, parseLegacyIdentifier } =
  await import("../../../utils/crypto-migration/external-identity-migration.js");

function user(id: string, extra: Record<string, unknown>) {
  h.state.users.set(id, {
    id,
    username: id,
    passwordHash: "",
    isAdmin: false,
    isOidc: true,
    ...extra,
  });
}

beforeEach(() => {
  h.state = createAuthState();
});

describe("parseLegacyIdentifier", () => {
  it("splits the prefixed forms and keeps bare subjects on their provider", () => {
    expect(parseLegacyIdentifier("ldap:4:bob", null)).toEqual({
      providerId: "4",
      subject: "bob",
    });
    expect(parseLegacyIdentifier("github:7:42", null)).toEqual({
      providerId: "7",
      subject: "42",
    });
    expect(parseLegacyIdentifier("ldap:4:cn=a:b", null)).toEqual({
      providerId: "4",
      subject: "cn=a:b",
    });
    expect(parseLegacyIdentifier("sub-123", 3)).toEqual({
      providerId: "3",
      subject: "sub-123",
    });
    expect(parseLegacyIdentifier("sub-123", null)).toEqual({
      providerId: "legacy-oidc",
      subject: "sub-123",
    });
    expect(parseLegacyIdentifier("github:null:42", null)).toEqual({
      providerId: "legacy-oidc",
      subject: "42",
    });
  });
});

describe("runExternalIdentityMigration", () => {
  it("moves every identifier without touching the old data", async () => {
    user("ldap-user", { oidcIdentifier: "ldap:4:bob", ssoProviderId: 4 });
    user("gh-user", { oidcIdentifier: "github:7:42", ssoProviderId: 7 });
    user("oidc-user", {
      oidcIdentifier: "sub-123",
      ssoProviderId: 3,
    });
    user("env-user", { oidcIdentifier: "someone@example.com" });
    user("local", { isOidc: false, passwordHash: "hash" });

    const result = await runExternalIdentityMigration();

    expect(result).toEqual({ identities: 4, skipped: 0 });
    expect(
      h.state.identities.map(({ userId, providerId, subject }) => ({
        userId,
        providerId,
        subject,
      })),
    ).toEqual([
      { userId: "ldap-user", providerId: "4", subject: "bob" },
      { userId: "gh-user", providerId: "7", subject: "42" },
      { userId: "oidc-user", providerId: "3", subject: "sub-123" },
      {
        userId: "env-user",
        providerId: "legacy-oidc",
        subject: "someone@example.com",
      },
    ]);
    // Lossless: the old column stays.
    expect(h.state.users.get("ldap-user")!.oidcIdentifier).toBe("ldap:4:bob");
  });

  it("is idempotent", async () => {
    user("ldap-user", { oidcIdentifier: "ldap:4:bob" });
    await runExternalIdentityMigration();
    const second = await runExternalIdentityMigration();
    expect(second).toEqual({ identities: 0, skipped: 1 });
    expect(h.state.identities).toHaveLength(1);
  });
});
