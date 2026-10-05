import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  pickResolvedUsername,
  pickResolvedPassword,
  expandExternalUsername,
} from "../../hosts/credential-username.js";

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

describe("pickResolvedPassword", () => {
  it("keeps the host-specific password ahead of the credential password", () => {
    expect(pickResolvedPassword("host-pass", "credential-pass")).toBe(
      "host-pass",
    );
  });

  it("falls back to the credential password when the host has none", () => {
    expect(pickResolvedPassword("", "credential-pass")).toBe("credential-pass");
    expect(pickResolvedPassword(undefined, "credential-pass")).toBe(
      "credential-pass",
    );
  });

  it("treats whitespace-only passwords as empty", () => {
    expect(pickResolvedPassword("   ", "credential-pass")).toBe(
      "credential-pass",
    );
  });
});

function identities(rows: Array<{ id: number; subject: string }>) {
  vi.doMock("../../database/repositories/factory.js", () => ({
    createCurrentUserAuthRepository: () => ({
      listIdentitiesForUser: async () => rows,
    }),
  }));
}

describe("expandExternalUsername", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the username unchanged when it has no placeholder", async () => {
    expect(await expandExternalUsername("alice", "user-1")).toBe("alice");
    expect(await expandExternalUsername(undefined, "user-1")).toBeUndefined();
  });

  it("expands the placeholder with the subject of the user's first identity", async () => {
    identities([
      { id: 4, subject: "later" },
      { id: 2, subject: "jdoe" },
    ]);
    const { expandExternalUsername: expand } =
      await import("../../hosts/credential-username.js");
    expect(await expand("$external.username", "user-1")).toBe("jdoe");
    expect(await expand("$external.username-x", "user-1")).toBe("jdoe-x");
  });

  it("no longer reads the 2.8 spelling", async () => {
    identities([{ id: 1, subject: "jdoe" }]);
    const { expandExternalUsername: expand } =
      await import("../../hosts/credential-username.js");
    expect(await expand("$oidc.preferred_username", "user-1")).toBe(
      "$oidc.preferred_username",
    );
  });

  it("leaves the placeholder as-is when the user has no external sign-in", async () => {
    identities([]);
    const { expandExternalUsername: expand } =
      await import("../../hosts/credential-username.js");
    expect(await expand("$external.username", "user-1")).toBe(
      "$external.username",
    );
  });

  it("returns the username unchanged when the DB lookup throws", async () => {
    vi.doMock("../../database/repositories/factory.js", () => ({
      createCurrentUserAuthRepository: () => {
        throw new Error("DB unavailable");
      },
    }));
    const { expandExternalUsername: expand } =
      await import("../../hosts/credential-username.js");
    expect(await expand("$external.username", "user-1")).toBe(
      "$external.username",
    );
  });
});
