import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// user-oidc-utils imports the logger; stub it so importing stays side-effect-free.
vi.mock("../../utils/logger.js", () => ({
  authLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { isOIDCUserAllowed, getOIDCConfigFromEnv, extractOidcGroups } =
  await import("./user-oidc-utils.js");

describe("isOIDCUserAllowed", () => {
  it("allows everyone when the allow-list is empty", () => {
    expect(isOIDCUserAllowed("", "alice", "alice@x.com")).toBe(true);
    expect(isOIDCUserAllowed("   ", "alice")).toBe(true);
  });

  it("allows everyone with the '*' wildcard", () => {
    expect(isOIDCUserAllowed("*", "anyone", "anyone@x.com")).toBe(true);
  });

  it("matches an exact identifier (case-insensitive)", () => {
    expect(isOIDCUserAllowed("alice,bob", "alice")).toBe(true);
    expect(isOIDCUserAllowed("Alice", "alice")).toBe(true);
    expect(isOIDCUserAllowed("alice", "ALICE")).toBe(true);
  });

  it("matches against the email as well as the identifier", () => {
    expect(isOIDCUserAllowed("alice@x.com", "sub-123", "alice@x.com")).toBe(
      true,
    );
  });

  it("matches an @domain suffix pattern", () => {
    expect(isOIDCUserAllowed("@company.com", "sub-1", "bob@company.com")).toBe(
      true,
    );
    expect(isOIDCUserAllowed("@company.com", "sub-1", "bob@COMPANY.COM")).toBe(
      true,
    );
  });

  it("denies users not on the list", () => {
    expect(isOIDCUserAllowed("alice,bob", "charlie", "charlie@x.com")).toBe(
      false,
    );
    expect(isOIDCUserAllowed("@company.com", "sub-1", "bob@other.com")).toBe(
      false,
    );
  });

  it("ignores blank entries and surrounding whitespace in the list", () => {
    expect(isOIDCUserAllowed(" alice , , bob ", "bob")).toBe(true);
  });

  it("does not match the email against an identifier-only pattern when email differs", () => {
    expect(isOIDCUserAllowed("alice", "sub-123", "alice@x.com")).toBe(false);
  });

  it("matches *@domain.com wildcard pattern against emails", () => {
    expect(
      isOIDCUserAllowed("*@company.com", "sub-1", "john@company.com"),
    ).toBe(true);
    expect(
      isOIDCUserAllowed("*@company.com", "sub-1", "jane@COMPANY.COM"),
    ).toBe(true);
    expect(isOIDCUserAllowed("*@company.com", "sub-1", "user@other.com")).toBe(
      false,
    );
  });

  it("matches glob patterns with multiple wildcards", () => {
    expect(isOIDCUserAllowed("admin*", "admin_user")).toBe(true);
    expect(isOIDCUserAllowed("admin*", "user_admin")).toBe(false);
  });
});

describe("getOIDCConfigFromEnv", () => {
  const REQUIRED = [
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "OIDC_ISSUER_URL",
    "OIDC_AUTHORIZATION_URL",
    "OIDC_TOKEN_URL",
  ];
  const OPTIONAL = [
    "OIDC_USERINFO_URL",
    "OIDC_IDENTIFIER_PATH",
    "OIDC_NAME_PATH",
    "OIDC_SCOPES",
    "OIDC_ALLOWED_USERS",
    "OIDC_ADMIN_GROUP",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [...REQUIRED, ...OPTIONAL]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of [...REQUIRED, ...OPTIONAL]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("returns null when any required variable is missing", () => {
    process.env.OIDC_CLIENT_ID = "id";
    process.env.OIDC_CLIENT_SECRET = "secret";
    // issuer/authorization/token urls intentionally missing
    expect(getOIDCConfigFromEnv()).toBeNull();
  });

  it("builds a config with defaults when all required vars are present", () => {
    process.env.OIDC_CLIENT_ID = "id";
    process.env.OIDC_CLIENT_SECRET = "secret";
    process.env.OIDC_ISSUER_URL = "https://idp.example";
    process.env.OIDC_AUTHORIZATION_URL = "https://idp.example/auth";
    process.env.OIDC_TOKEN_URL = "https://idp.example/token";

    const config = getOIDCConfigFromEnv();
    expect(config).not.toBeNull();
    expect(config?.client_id).toBe("id");
    expect(config?.identifier_path).toBe("sub");
    expect(config?.name_path).toBe("name");
    expect(config?.scopes).toBe("openid email profile");
    expect(config?.userinfo_url).toBe("");
  });

  it("honors overrides for optional vars", () => {
    process.env.OIDC_CLIENT_ID = "id";
    process.env.OIDC_CLIENT_SECRET = "secret";
    process.env.OIDC_ISSUER_URL = "https://idp.example";
    process.env.OIDC_AUTHORIZATION_URL = "https://idp.example/auth";
    process.env.OIDC_TOKEN_URL = "https://idp.example/token";
    process.env.OIDC_IDENTIFIER_PATH = "email";
    process.env.OIDC_SCOPES = "openid";

    const config = getOIDCConfigFromEnv();
    expect(config?.identifier_path).toBe("email");
    expect(config?.scopes).toBe("openid");
  });
});

describe("extractOidcGroups", () => {
  it("reads the standard groups claim as an array", () => {
    expect(extractOidcGroups({ groups: ["admin", "user"] })).toEqual([
      "admin",
      "user",
    ]);
  });

  it("splits a comma-separated string claim", () => {
    expect(extractOidcGroups({ roles: "admin, user" })).toEqual([
      "admin",
      "user",
    ]);
  });

  it("falls back through groups, roles, then group", () => {
    expect(extractOidcGroups({ group: "ops" })).toEqual(["ops"]);
  });

  it("reads a custom claim path when provided", () => {
    const userInfo = {
      "zitadel:grants:groups:123": ["user", "admin"],
      groups: ["ignored"],
    };
    expect(extractOidcGroups(userInfo, "zitadel:grants:groups:123")).toEqual([
      "user",
      "admin",
    ]);
  });

  it("uses object keys as group names (Zitadel roles object)", () => {
    const userInfo = {
      "urn:zitadel:iam:org:project:roles": { admin: {}, user: {} },
    };
    expect(
      extractOidcGroups(userInfo, "urn:zitadel:iam:org:project:roles"),
    ).toEqual(["admin", "user"]);
  });

  it("falls back to defaults when the custom claim is absent", () => {
    expect(extractOidcGroups({ groups: ["admin"] }, "missing")).toEqual([
      "admin",
    ]);
  });

  it("returns an empty array when no groups are present", () => {
    expect(extractOidcGroups({})).toEqual([]);
  });
});
