import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, type TestServer } from "./helpers.js";

const directory = vi.hoisted(() => ({
  users: {} as Record<
    string,
    { dn: string; password: string; attrs: Record<string, string> }
  >,
  adminDns: [] as string[],
  servicePassword: "svc",
  binds: [] as string[],
}));

vi.mock("ldapjs", () => {
  function createClient() {
    return {
      bind: (dn: string, password: string, cb: (err?: Error) => void) => {
        directory.binds.push(dn);
        if (dn === "cn=service" && password === directory.servicePassword) {
          return cb();
        }
        const user = Object.values(directory.users).find((u) => u.dn === dn);
        if (user && user.password === password) return cb();
        cb(new Error("invalid credentials"));
      },
      search: (
        base: string,
        options: { filter: string },
        cb: (err: Error | null, res: unknown) => void,
      ) => {
        const listeners: Record<string, (value?: unknown) => void> = {};
        cb(null, {
          on: (event: string, fn: (value?: unknown) => void) => {
            listeners[event] = fn;
          },
        });
        queueMicrotask(() => {
          if (base === "ou=groups") {
            for (const dn of directory.adminDns) {
              if (options.filter.includes(dn)) {
                listeners.searchEntry?.({
                  dn: { toString: () => "cn=admins,ou=groups" },
                  attributes: [{ type: "cn", values: ["admins"] }],
                });
              }
            }
          } else {
            const match = /uid=([^)]+)/.exec(options.filter);
            const user = match ? directory.users[match[1]] : undefined;
            if (user) {
              listeners.searchEntry?.({
                dn: { toString: () => user.dn },
                attributes: Object.entries(user.attrs).map(([type, value]) => ({
                  type,
                  values: [value],
                })),
              });
            }
          }
          listeners.end?.();
        });
      },
      unbind: () => {},
    };
  }
  return { default: { createClient }, createClient };
});

const CONFIG = {
  host: "ldap.example",
  port: 389,
  bindDN: "cn=service",
  bindPassword: "svc",
  userSearchBase: "ou=people",
  userSearchFilter: "(uid={{username}})",
  usernameAttribute: "uid",
  displayNameAttribute: "cn",
  groupSearchBase: "ou=groups",
  adminGroup: "admins",
  allowedUsers: "@example.com",
};

let server: TestServer | null = null;

beforeEach(() => {
  directory.users = {
    bob: {
      dn: "uid=bob,ou=people",
      password: "hunter2",
      attrs: { uid: "bob", cn: "Bob Builder", mail: "bob@example.com" },
    },
  };
  directory.adminDns = [];
  directory.binds = [];
});

afterEach(async () => {
  await server?.close();
  server = null;
});

async function withDirectory(options: Parameters<typeof startServer>[0] = {}) {
  server = await startServer(options);
  const created = await server.request("POST", "/providers", {
    body: { name: "Corp LDAP", config: CONFIG },
  });
  expect(created.status).toBe(201);
  return { s: server, id: created.body.id as number };
}

function verify(
  s: TestServer,
  instance: string,
  body: Record<string, unknown>,
) {
  const method = s.mock.auth.loginMethods[0];
  return method.verify!(
    { body, query: {}, headers: {}, ip: "10.0.0.1" },
    instance,
  );
}

describe("LDAP sign-in", () => {
  it("binds as the service, then as the user, and returns the identity", async () => {
    const { s, id } = await withDirectory();
    directory.adminDns = ["uid=bob,ou=people"];
    const identity = await verify(s, String(id), {
      username: "bob",
      password: "hunter2",
      rememberMe: true,
    });
    expect(identity).toEqual({
      kind: "external",
      provider: `ldap:${id}`,
      subject: "bob",
      email: "bob@example.com",
      name: "Bob Builder",
      isAdmin: true,
      allowedUsers: "@example.com",
      legacy: { identifier: `ldap:${id}:bob`, providerRowId: id },
      rememberMe: true,
      rateLimitKey: `${id}:bob`,
    });
    expect(directory.binds).toEqual(["cn=service", "uid=bob,ou=people"]);
  });

  it("is not an admin when the directory says so", async () => {
    const { s, id } = await withDirectory();
    const identity = await verify(s, String(id), {
      username: "bob",
      password: "hunter2",
    });
    expect(identity).toMatchObject({ isAdmin: false });
  });

  it("refuses a wrong password and an unknown user the same way", async () => {
    const { s, id } = await withDirectory();
    await expect(
      verify(s, String(id), { username: "bob", password: "nope" }),
    ).rejects.toMatchObject({
      status: 401,
      message: "Invalid username or password",
    });
    await expect(
      verify(s, String(id), { username: "mallory", password: "x" }),
    ).rejects.toMatchObject({
      status: 401,
      message: "Invalid username or password",
    });
    expect(s.mock.auth.loginFailures.get(`10.0.0.1|${id}:bob`)).toBe(1);
  });

  it("locks out after too many failures, like password login", async () => {
    const { s, id } = await withDirectory({ loginAttemptLimit: 2 });
    for (let i = 0; i < 2; i++) {
      await expect(
        verify(s, String(id), { username: "bob", password: "nope" }),
      ).rejects.toMatchObject({ status: 401 });
    }
    await expect(
      verify(s, String(id), { username: "bob", password: "hunter2" }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("escapes the username in the search filter", async () => {
    const { s, id } = await withDirectory();
    await expect(
      verify(s, String(id), { username: "bob)(uid=*", password: "hunter2" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("refuses a disabled or unknown directory", async () => {
    const { s, id } = await withDirectory();
    await s.request("PUT", `/providers/${id}`, { body: { enabled: false } });
    await expect(
      verify(s, String(id), { username: "bob", password: "hunter2" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      verify(s, "999", { username: "bob", password: "hunter2" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await s.mock.auth.loginMethods[0].describe!()).toEqual([
      { id: String(id), label: "Corp LDAP", enabled: false, type: "ldap" },
    ]);
  });

  it("needs a directory, a username and a password", async () => {
    const { s } = await withDirectory();
    await expect(
      verify(s, null as never, { username: "bob" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("directory admin routes", () => {
  it("seal the bind password and never send it back", async () => {
    const { s, id } = await withDirectory();
    const stored = s.db.sqlite
      .prepare("SELECT config FROM p_ldap_providers WHERE id = ?")
      .get(id) as { config: string };
    expect(JSON.parse(stored.config).bindPassword).toMatch(/^sealed:/);

    const listed = await s.request("GET", "/providers");
    expect(listed.body.providers[0]).toMatchObject({
      name: "Corp LDAP",
      hasBindPassword: true,
    });
    expect(listed.body.providers[0].config.bindPassword).toBeUndefined();
  });

  it("keep the bind password when an edit leaves it empty", async () => {
    const { s, id } = await withDirectory();
    const updated = await s.request("PUT", `/providers/${id}`, {
      body: { config: { host: "ldap2.example", bindPassword: "" } },
    });
    expect(updated.body).toMatchObject({
      hasBindPassword: true,
      config: { host: "ldap2.example" },
    });
    await expect(
      verify(s, String(id), { username: "bob", password: "hunter2" }),
    ).resolves.toMatchObject({ subject: "bob" });
  });

  it("reject a directory with missing fields", async () => {
    server = await startServer();
    const response = await server.request("POST", "/providers", {
      body: { name: "X", config: { host: "a" } },
    });
    expect(response.status).toBe(400);
  });

  it("will not delete a directory people still sign in with", async () => {
    const { s, id } = await withDirectory({
      linkedUsers: { "ldap:1": 1 },
    });
    expect(id).toBe(1);
    expect((await s.request("DELETE", `/providers/${id}`)).status).toBe(409);
  });

  it("delete a directory nobody uses", async () => {
    const { s, id } = await withDirectory();
    expect((await s.request("DELETE", `/providers/${id}`)).status).toBe(200);
    expect(await s.mock.auth.loginMethods[0].describe!()).toEqual([]);
  });

  it("need ldap.manage", async () => {
    server = await startServer({ permissions: [] });
    for (const [method, path] of [
      ["GET", "/providers"],
      ["POST", "/providers"],
      ["PUT", "/providers/1"],
      ["DELETE", "/providers/1"],
    ]) {
      expect((await server.request(method, path, { body: {} })).status).toBe(
        403,
      );
    }
  });
});

describe("capabilities", () => {
  it.each(["db:own", "auth:provide", "network:serve"])(
    "activate fails closed without %s",
    async (capability) => {
      const { manifest } = await import("./helpers.js");
      await expect(
        startServer({
          capabilities: manifest.capabilities.filter((c) => c !== capability),
        }),
      ).rejects.toThrow();
    },
  );

  it("cannot read a bind password without secrets:own", async () => {
    const { manifest } = await import("./helpers.js");
    server = await startServer({
      capabilities: manifest.capabilities.filter((c) => c !== "secrets:own"),
    });
    const response = await server.request("POST", "/providers", {
      body: { name: "Corp LDAP", config: CONFIG },
    });
    expect(response.status).toBe(500);
  });
});
