import { describe, expect, it } from "vitest";
import { isExternalUserAllowed } from "../../auth/allowed-users.js";

describe("isExternalUserAllowed", () => {
  it("allows everyone when the allow-list is empty", () => {
    expect(isExternalUserAllowed("", "alice", "alice@x.com")).toBe(true);
    expect(isExternalUserAllowed("   ", "alice")).toBe(true);
  });

  it("allows everyone with the '*' wildcard", () => {
    expect(isExternalUserAllowed("*", "anyone", "anyone@x.com")).toBe(true);
  });

  it("matches an exact identifier (case-insensitive)", () => {
    expect(isExternalUserAllowed("alice,bob", "alice")).toBe(true);
    expect(isExternalUserAllowed("Alice", "alice")).toBe(true);
    expect(isExternalUserAllowed("alice", "ALICE")).toBe(true);
  });

  it("matches against the email as well as the identifier", () => {
    expect(isExternalUserAllowed("alice@x.com", "sub-123", "alice@x.com")).toBe(
      true,
    );
  });

  it("matches an @domain suffix pattern", () => {
    expect(
      isExternalUserAllowed("@company.com", "sub-1", "bob@company.com"),
    ).toBe(true);
    expect(
      isExternalUserAllowed("@company.com", "sub-1", "bob@COMPANY.COM"),
    ).toBe(true);
  });

  it("denies users not on the list", () => {
    expect(isExternalUserAllowed("alice,bob", "charlie", "charlie@x.com")).toBe(
      false,
    );
    expect(
      isExternalUserAllowed("@company.com", "sub-1", "bob@other.com"),
    ).toBe(false);
  });

  it("ignores blank entries and surrounding whitespace in the list", () => {
    expect(isExternalUserAllowed(" alice , , bob ", "bob")).toBe(true);
  });

  it("does not match the email against an identifier-only pattern when email differs", () => {
    expect(isExternalUserAllowed("alice", "sub-123", "alice@x.com")).toBe(
      false,
    );
  });

  it("matches *@domain.com wildcard pattern against emails", () => {
    expect(
      isExternalUserAllowed("*@company.com", "sub-1", "john@company.com"),
    ).toBe(true);
    expect(
      isExternalUserAllowed("*@company.com", "sub-1", "jane@COMPANY.COM"),
    ).toBe(true);
    expect(
      isExternalUserAllowed("*@company.com", "sub-1", "user@other.com"),
    ).toBe(false);
  });

  it("matches glob patterns with multiple wildcards", () => {
    expect(isExternalUserAllowed("admin*", "admin_user")).toBe(true);
    expect(isExternalUserAllowed("admin*", "user_admin")).toBe(false);
  });
});
