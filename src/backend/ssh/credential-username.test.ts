import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  pickResolvedUsername,
  expandOidcUsername,
} from "./credential-username.js";

describe("pickResolvedUsername", () => {
  it("keeps the host username when one is set, even with a credential username", () => {
    expect(pickResolvedUsername("admin", "root", false)).toBe("admin");
  });

  it("falls back to the credential username when the host has none", () => {
    expect(pickResolvedUsername("", "root", false)).toBe("root");
    expect(pickResolvedUsername(undefined, "root", false)).toBe("root");
    expect(pickResolvedUsername("   ", "root", false)).toBe("root");
  });

  it("treats whitespace-only host usernames as empty", () => {
    expect(pickResolvedUsername("  ", "deploy", false)).toBe("deploy");
  });

  it("forces the host username when overrideCredentialUsername is set", () => {
    expect(pickResolvedUsername("admin", "root", true)).toBe("admin");
    expect(pickResolvedUsername("", "root", true)).toBeUndefined();
  });

  it("returns undefined when neither username is usable", () => {
    expect(pickResolvedUsername("", "", false)).toBeUndefined();
    expect(pickResolvedUsername(undefined, undefined, false)).toBeUndefined();
  });
});

describe("expandOidcUsername", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the username unchanged when it has no placeholder", async () => {
    expect(await expandOidcUsername("alice", "user-1")).toBe("alice");
    expect(await expandOidcUsername(undefined, "user-1")).toBeUndefined();
  });

  it("expands the placeholder with the user's OIDC identifier", async () => {
    vi.doMock("../database/db/index.js", () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ oidcIdentifier: "jdoe" }],
            }),
          }),
        }),
      }),
    }));
    vi.doMock("../database/db/schema.js", () => ({ users: {} }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn() }));

    const { expandOidcUsername: expand } =
      await import("./credential-username.js");
    expect(await expand("$oidc.preferred_username", "user-1")).toBe("jdoe");
  });

  it("leaves the placeholder as-is when the user has no OIDC identifier", async () => {
    vi.doMock("../database/db/index.js", () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ oidcIdentifier: null }],
            }),
          }),
        }),
      }),
    }));
    vi.doMock("../database/db/schema.js", () => ({ users: {} }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn() }));

    const { expandOidcUsername: expand } =
      await import("./credential-username.js");
    expect(await expand("$oidc.preferred_username", "user-1")).toBe(
      "$oidc.preferred_username",
    );
  });

  it("returns the username unchanged when the DB lookup throws", async () => {
    vi.doMock("../database/db/index.js", () => ({
      getDb: () => {
        throw new Error("DB unavailable");
      },
    }));

    const { expandOidcUsername: expand } =
      await import("./credential-username.js");
    expect(await expand("$oidc.preferred_username", "user-1")).toBe(
      "$oidc.preferred_username",
    );
  });
});
