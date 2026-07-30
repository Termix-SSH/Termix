import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// user-oidc-utils imports the logger; stub it so importing stays side-effect-free.
vi.mock("../../../utils/logger.js", () => ({
  authLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const {
  isOIDCUserAllowed,
  getOIDCConfigFromEnv,
  extractOidcGroups,
  validateLogoutTokenClaims,
  parseOidcRoleMap,
  resolveOidcMappedRoles,
} = await import("../../../database/routes/user-oidc-utils.js");

const BACKCHANNEL_LOGOUT_EVENT =
  "http://schemas.openid.net/event/backchannel-logout";

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

describe("validateLogoutTokenClaims", () => {
  const validClaims = {
    sub: "subject-1",
    sid: "session-1",
    iat: 1_783_641_600,
    jti: "logout-1",
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
  };

  it("accepts a spec-compliant back-channel logout payload", () => {
    expect(validateLogoutTokenClaims(validClaims)).toEqual({
      sub: "subject-1",
      sid: "session-1",
      jti: "logout-1",
    });
  });

  it("requires the logout event to contain an object", () => {
    expect(() =>
      validateLogoutTokenClaims({
        ...validClaims,
        events: { [BACKCHANNEL_LOGOUT_EVENT]: true },
      }),
    ).toThrow("missing back-channel logout event");
  });

  it("requires iat and jti claims", () => {
    expect(() =>
      validateLogoutTokenClaims({ ...validClaims, iat: undefined }),
    ).toThrow("missing iat claim");
    expect(() =>
      validateLogoutTokenClaims({ ...validClaims, jti: "" }),
    ).toThrow("missing jti claim");
  });

  it("rejects nonce and requires sub or sid", () => {
    expect(() =>
      validateLogoutTokenClaims({ ...validClaims, nonce: "forbidden" }),
    ).toThrow("must not contain a nonce");
    expect(() =>
      validateLogoutTokenClaims({ ...validClaims, sub: null, sid: null }),
    ).toThrow("must contain sub and/or sid");
  });
});

describe("parseOidcRoleMap", () => {
  it("returns an empty map for blank input", () => {
    expect(parseOidcRoleMap(undefined).size).toBe(0);
    expect(parseOidcRoleMap(null).size).toBe(0);
    expect(parseOidcRoleMap("   ").size).toBe(0);
  });

  it("parses comma-separated group:role pairs", () => {
    const map = parseOidcRoleMap(
      "devops-interns:devops-intern,devops-seniors:devops-senior",
    );
    expect(map.get("devops-interns")).toBe("devops-intern");
    expect(map.get("devops-seniors")).toBe("devops-senior");
    expect(map.size).toBe(2);
  });

  it("parses newline-separated pairs and trims whitespace", () => {
    const map = parseOidcRoleMap("  a : role-a \n b:role-b \n");
    expect(map.get("a")).toBe("role-a");
    expect(map.get("b")).toBe("role-b");
  });

  it("normalizes leading slashes and case in group names", () => {
    const map = parseOidcRoleMap("/DevOps-Interns:devops-intern");
    expect(map.get("devops-interns")).toBe("devops-intern");
  });

  it("skips malformed entries instead of throwing", () => {
    const map = parseOidcRoleMap("no-colon,:missing-group,missing-role:,ok:r");
    expect(map.size).toBe(1);
    expect(map.get("ok")).toBe("r");
  });

  it("splits on the last colon so group names may contain colons", () => {
    const map = parseOidcRoleMap("ns:team:role-x");
    expect(map.get("ns:team")).toBe("role-x");
  });

  it("preserves role-name case verbatim", () => {
    // Role names must match roles.name exactly, so they are not lowercased.
    expect(parseOidcRoleMap("g:DevOps_Senior").get("g")).toBe("DevOps_Senior");
  });
});

describe("resolveOidcMappedRoles", () => {
  const roleMap = parseOidcRoleMap(
    "devops-interns:devops-intern,devops-seniors:devops-senior",
  );

  it("reports every mapped role as managed regardless of membership", () => {
    const { managed } = resolveOidcMappedRoles([], roleMap);
    expect([...managed].sort()).toEqual(["devops-intern", "devops-senior"]);
  });

  it("desires only the roles whose groups the user is in", () => {
    const { desired } = resolveOidcMappedRoles(["devops-interns"], roleMap);
    expect([...desired]).toEqual(["devops-intern"]);
  });

  it("matches full group paths emitted by Keycloak", () => {
    const { desired } = resolveOidcMappedRoles(["/devops-seniors"], roleMap);
    expect([...desired]).toEqual(["devops-senior"]);
  });

  it("ignores groups that are not mapped", () => {
    const { desired } = resolveOidcMappedRoles(
      ["finance", "devops-interns"],
      roleMap,
    );
    expect([...desired]).toEqual(["devops-intern"]);
  });

  it("supports a user in multiple mapped groups", () => {
    const { desired } = resolveOidcMappedRoles(
      ["devops-interns", "devops-seniors"],
      roleMap,
    );
    expect([...desired].sort()).toEqual(["devops-intern", "devops-senior"]);
  });

  it("desires nothing when the map is empty", () => {
    const { desired, managed } = resolveOidcMappedRoles(
      ["devops-interns"],
      new Map(),
    );
    expect(desired.size).toBe(0);
    expect(managed.size).toBe(0);
  });
});
