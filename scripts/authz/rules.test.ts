import { describe, expect, it } from "vitest";
import {
  callsAllowed,
  expectFor,
  fillPath,
  grants,
  judgeHttp,
  judgeSocket,
  keyScopeAllows,
} from "./lib/rules.mjs";
import { checkTable, coverage } from "./lib/matrix.mjs";
import {
  API_KEY_SCOPES,
  keyScopeAllows as coreKeyScopeAllows,
} from "../../src/backend/operations/key-scopes.js";

const MEMBER = ["hosts.view", "snippets.use"];
const expect_ = (entry: object, who: string, method = "GET", path = "/x") =>
  expectFor(entry, who, method, path, MEMBER);

describe("expectFor", () => {
  it("refuses every bad session on a signed in route", () => {
    for (const who of [
      "anon",
      "expired",
      "revoked",
      "pending",
      "setup",
      "guest",
    ]) {
      expect(expect_({ access: "user" }, who)).toBe("refuse");
    }
  });

  it("lets a pending or setup session through only where the entry allows it", () => {
    const entry = { access: "user", allow: ["setup"] };
    expect(expect_(entry, "setup")).toBe("allow");
    expect(expect_(entry, "pending")).toBe("refuse");
  });

  it("only asks that anonymous callers get through a public route", () => {
    expect(expect_({ access: "public" }, "anon")).toBe("public");
    expect(expect_({ access: "public" }, "owner")).toBe("any");
  });

  it("refuses everyone but admins on an admin route", () => {
    expect(expect_({ access: "admin" }, "owner")).toBe("refuse");
    expect(expect_({ access: "admin" }, "admin")).toBe("allow");
  });

  it("refuses a permission the plain user role lacks", () => {
    expect(expect_({ access: "user", permission: "dns.manage" }, "owner")).toBe(
      "refuse",
    );
    expect(expect_({ access: "user", permission: "hosts.view" }, "owner")).toBe(
      "allow",
    );
    expect(
      expect_({ access: "user", permission: "hosts.view" }, "noperm"),
    ).toBe("refuse");
    expect(
      expect_(
        { access: "user", permission: ["hosts.view", "dns.view"] },
        "owner",
      ),
    ).toBe("refuse");
  });

  it("follows share levels on a host and refuses strangers", () => {
    const entry = { access: "user", resource: { kind: "host", min: "edit" } };
    expect(expect_(entry, "owner")).toBe("allow");
    expect(expect_(entry, "other")).toBe("refuse");
    expect(expect_(entry, "share-view")).toBe("refuse");
    expect(expect_(entry, "share-edit")).toBe("allow");
    expect(expect_(entry, "share-manage")).toBe("allow");
  });

  it("maps credential shares to use and manage", () => {
    const use = {
      access: "user",
      resource: { kind: "credential", min: "use" },
    };
    const manage = {
      access: "user",
      resource: { kind: "credential", min: "manage" },
    };
    expect(expect_(use, "share-connect")).toBe("allow");
    expect(expect_(manage, "share-edit")).toBe("refuse");
    expect(expect_(manage, "share-manage")).toBe("allow");
  });

  it("never lets a share reach an owner only resource", () => {
    const entry = { access: "user", resource: { kind: "own", fixture: "x" } };
    expect(expect_(entry, "share-manage")).toBe("refuse");
    expect(expect_(entry, "owner")).toBe("allow");
  });

  it("leaves admins unchecked on resources unless the entry says", () => {
    expect(
      expect_({ access: "user", resource: { kind: "own" } }, "admin"),
    ).toBe("any");
    expect(
      expect_(
        { access: "user", resource: { kind: "own", admin: false } },
        "admin",
      ),
    ).toBe("refuse");
  });

  it("limits API keys to their scopes and then treats them as the owner", () => {
    const entry = { access: "user" };
    expect(
      expectFor(entry, "key-ops-read", "GET", "/host/db/host", MEMBER),
    ).toBe("refuse");
    expect(
      expectFor(entry, "key-ops-read", "GET", "/operations/runs", MEMBER),
    ).toBe("allow");
    expect(
      expectFor(
        entry,
        "key-ops-read",
        "POST",
        "/operations/runs/1/cancel",
        MEMBER,
      ),
    ).toBe("refuse");
    expect(
      expectFor(
        entry,
        "key-ops-run",
        "POST",
        "/operations/runs/1/cancel",
        MEMBER,
      ),
    ).toBe("allow");
  });

  it("lets an explicit expectation win", () => {
    expect(
      expect_({ access: "user", expect: { owner: "refuse" } }, "owner"),
    ).toBe("refuse");
  });

  it("does not check allowed cells marked any", () => {
    expect(expect_({ access: "user", allowed: "any" }, "owner")).toBe("any");
    expect(expect_({ access: "user", allowed: "any" }, "anon")).toBe("refuse");
  });
});

describe("keyScopeAllows", () => {
  it("matches core's rule", () => {
    const cases: Array<[string[] | null, string, string]> = [
      [null, "GET", "/host/db/host"],
      [["operations:read"], "GET", "/operations/runs"],
      [["operations:read"], "POST", "/operations/x/run"],
      [["operations:read"], "POST", "/operations/runs/1/undo"],
      [["operations:run"], "POST", "/operations/runs/1/undo"],
      [["operations:read"], "GET", "/plugin-api/operations-center/mcp"],
      [["operations:run"], "GET", "/plugin-api/snippets/"],
      [[], "GET", "/operations/runs"],
    ];
    for (const [scopes, method, path] of cases) {
      expect(keyScopeAllows(scopes, method, path)).toBe(
        coreKeyScopeAllows(scopes, method, path),
      );
    }
    expect(API_KEY_SCOPES).toEqual(["operations:read", "operations:run"]);
  });
});

describe("grants", () => {
  it("understands wildcards", () => {
    expect(grants(["*"], "a.b")).toBe(true);
    expect(grants(["dns.*"], "dns.manage")).toBe(true);
    expect(grants(["dns.view"], "dns.manage")).toBe(false);
  });
});

describe("judging", () => {
  it("reads refusals", () => {
    expect(judgeHttp("refuse", 403).ok).toBe(true);
    expect(judgeHttp("refuse", 404).ok).toBe(true);
    expect(judgeHttp("refuse", 200).ok).toBe(false);
    expect(judgeHttp("refuse", 400).why).toMatch(/never reached the check/);
    expect(judgeHttp("allow", 401).ok).toBe(false);
    expect(judgeHttp("allow", 500).ok).toBe(true);
    expect(judgeHttp("public", 401).ok).toBe(false);
    expect(judgeHttp("public", 404).ok).toBe(true);
    expect(judgeHttp("allow", 503).ok).toBe(false);
  });

  it("reads sockets", () => {
    expect(judgeSocket("refuse", { open: false, status: 401 }).ok).toBe(true);
    expect(
      judgeSocket("refuse", { open: false, status: 101, closeCode: 1008 }).ok,
    ).toBe(true);
    expect(judgeSocket("refuse", { open: true, status: 101 }).ok).toBe(false);
    const replied = {
      open: true,
      status: 101,
      messages: [{ type: "error", message: "Host not found" }],
    };
    expect(judgeSocket("refuse", replied, undefined, "Host not found").ok).toBe(
      true,
    );
    expect(judgeSocket("allow", replied, undefined, "Host not found").ok).toBe(
      false,
    );
  });
});

describe("callsAllowed", () => {
  it("calls reads but only opted in writes", () => {
    expect(callsAllowed({}, "GET")).toBe(true);
    expect(callsAllowed({}, "POST")).toBe(false);
    expect(callsAllowed({ callAllowed: true }, "POST")).toBe(true);
    expect(callsAllowed({ destructive: true }, "GET")).toBe(false);
  });
});

describe("fillPath", () => {
  it("fills params from the entry, then by name", () => {
    const filled = fillPath(
      "/x/:hostId/y/:id/:protocol",
      { resource: { kind: "own", fixture: "thing" } },
      { host: 3, thing: "t 1" },
    );
    expect(filled).toEqual({ path: "/x/3/y/t%201/ssh", missing: [] });
  });

  it("reports a fixture nobody seeded", () => {
    expect(fillPath("/x/:id", { params: { id: "nope" } }, {}).missing).toEqual([
      "id (fixture nope)",
    ]);
  });
});

describe("coverage", () => {
  it("fails on a served route with no entry and an entry with no route", () => {
    const table = {
      routes: {
        "GET /a": {},
        "GET /gone": {},
        "GET /desk": { unlisted: "desktop" },
      },
    };
    const problems = coverage(table, [
      { method: "GET", path: "/a" },
      { method: "POST", path: "/new" },
    ]);
    expect(problems).toEqual([
      "no entry for POST /new",
      'entry GET /gone matches no served route (remove it, or say why in "unlisted")',
    ]);
  });

  it("matches a nested router route by its tail", () => {
    const table = { routes: { "GET /plugin-api/p/stats/:id": {} } };
    expect(
      coverage(
        table,
        [{ method: "GET", path: "/plugin-api/p/:id", partial: true }],
        {
          pluginId: "p",
        },
      ),
    ).toEqual([]);
  });
});

describe("checkTable", () => {
  it("catches unknown fields and bad values", () => {
    expect(
      checkTable({
        routes: {
          "GET /a": { access: "user", resorce: {} },
          "GET /b": { access: "users" },
          "GET /c": {
            access: "user",
            expect: { ownr: "allow" },
            allow: ["admin"],
          },
          "/d": { access: "user" },
        },
        seed: [{ as: "nobody", path: "/x" }],
        extra: true,
      }),
    ).toEqual([
      'unknown field "extra"',
      'GET /a: unknown field "resorce"',
      "GET /b: access must be public, user or admin",
      'GET /c: unknown identity "ownr" in expect',
      "GET /c: allow takes pending, setup or guest",
      'bad route key "/d"',
      'seed /x: unknown identity "nobody"',
    ]);
  });
});
