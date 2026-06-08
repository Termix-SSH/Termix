import { describe, it, expect } from "vitest";
import { pickResolvedUsername } from "./credential-username.js";

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
