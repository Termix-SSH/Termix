import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webauthn = vi.hoisted(() => ({
  verifyRegistration: vi.fn(),
  verifyAuthentication: vi.fn(),
  registrationOptions: vi.fn(),
  authenticationOptions: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: webauthn.registrationOptions,
  generateAuthenticationOptions: webauthn.authenticationOptions,
  verifyRegistrationResponse: webauthn.verifyRegistration,
  verifyAuthenticationResponse: webauthn.verifyAuthentication,
}));

import { startServer, type TestServer } from "./helpers";
import { requestOrigin } from "../../src/backend/passkeys.js";

let server: TestServer | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  webauthn.registrationOptions.mockImplementation(async (input) => ({
    challenge: "reg-challenge",
    rp: { name: input.rpName, id: input.rpID },
  }));
  webauthn.authenticationOptions.mockImplementation(async (input) => ({
    challenge: "auth-challenge",
    allowCredentials: input.allowCredentials,
  }));
  webauthn.verifyRegistration.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: "cred-1",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
      },
      credentialDeviceType: "multiDevice",
      credentialBackedUp: true,
    },
  });
  webauthn.verifyAuthentication.mockResolvedValue({
    verified: true,
    authenticationInfo: {
      newCounter: 5,
      userVerified: true,
      credentialBackedUp: true,
      credentialDeviceType: "multiDevice",
    },
  });
});

afterEach(async () => {
  await server?.close();
  server = null;
});

function passkeyMethod(target: TestServer) {
  const method = target.mock.auth.loginMethods.find(
    (entry) => entry.id === "passkey",
  );
  if (!method?.verify) throw new Error("passkey method not registered");
  return method;
}

async function registerPasskey(target: TestServer, user = "user-1") {
  const options = await target.request("POST", "/register/options", {
    user,
    body: { userVerification: "required" },
  });
  expect(options.status).toBe(200);
  const verify = await target.request("POST", "/register/verify", {
    user,
    body: {
      challengeId: options.body.challengeId,
      name: "Laptop",
      response: { id: "cred-1", response: { transports: ["internal"] } },
    },
  });
  expect(verify.status).toBe(200);
}

async function loginWith(
  target: TestServer,
  body: Record<string, unknown> = {},
) {
  const options = await target.request("POST", "/authenticate/options", {
    user: "",
    body,
  });
  expect(options.status).toBe(200);
  return passkeyMethod(target).verify!(
    {
      body: {
        challengeId: options.body.challengeId,
        response: { id: "cred-1" },
      },
      query: {},
      headers: {},
    },
    null,
  );
}

describe("registration", () => {
  it("registers a passkey for the caller and lists it", async () => {
    server = await startServer();
    await registerPasskey(server);

    expect(webauthn.registrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpName: "Termix Test",
        rpID: "termix.test",
        userName: "user-1",
      }),
    );
    const list = await server.request("GET", "/credentials");
    expect(list.body.credentials).toEqual([
      expect.objectContaining({
        name: "Laptop",
        deviceType: "multiDevice",
        backedUp: true,
        transports: ["internal"],
        userVerification: "required",
      }),
    ]);
    expect(
      (await server.request("GET", "/credentials", { user: "user-2" })).body
        .credentials,
    ).toEqual([]);
  });

  it("refuses a challenge issued to someone else", async () => {
    server = await startServer();
    const options = await server.request("POST", "/register/options", {
      body: {},
    });
    const verify = await server.request("POST", "/register/verify", {
      user: "user-2",
      body: { challengeId: options.body.challengeId, response: { id: "x" } },
    });
    expect(verify.status).toBe(400);
  });

  it("refuses a failed attestation", async () => {
    server = await startServer();
    webauthn.verifyRegistration.mockResolvedValue({ verified: false });
    const options = await server.request("POST", "/register/options", {
      body: {},
    });
    const verify = await server.request("POST", "/register/verify", {
      body: { challengeId: options.body.challengeId, response: { id: "x" } },
    });
    expect(verify.status).toBe(400);
  });

  it("deletes only the caller's own passkey", async () => {
    server = await startServer();
    await registerPasskey(server);
    const [{ id }] = (await server.request("GET", "/credentials")).body
      .credentials;
    await server.request("DELETE", `/credentials/${id}`, { user: "user-2" });
    expect(
      (await server.request("GET", "/credentials")).body.credentials,
    ).toHaveLength(1);
    await server.request("DELETE", `/credentials/${id}`);
    expect(
      (await server.request("GET", "/credentials")).body.credentials,
    ).toHaveLength(0);
  });
});

describe("login", () => {
  it("says who signed in and counts a verified user as the second factor", async () => {
    server = await startServer();
    await registerPasskey(server);
    const identity = await loginWith(server);
    expect(identity).toMatchObject({
      kind: "user",
      userId: "user-1",
      mfaSatisfied: true,
    });
    const row = server.db.sqlite
      .prepare("SELECT counter, last_used_at FROM p_webauthn_credentials")
      .get() as { counter: number; last_used_at: string | null };
    expect(row.counter).toBe(5);
    expect(row.last_used_at).toBeTruthy();
  });

  it("leaves the second factor to core when the user was not verified", async () => {
    server = await startServer();
    await registerPasskey(server);
    webauthn.verifyAuthentication.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
        userVerified: false,
        credentialBackedUp: false,
        credentialDeviceType: "singleDevice",
      },
    });
    expect(await loginWith(server)).toMatchObject({ mfaSatisfied: false });
  });

  it("scopes the options to a username and 404s without passkeys", async () => {
    server = await startServer();
    await registerPasskey(server);
    const options = await server.request("POST", "/authenticate/options", {
      user: "",
      body: { username: "user-1" },
    });
    expect(options.body.options.allowCredentials).toEqual([
      { id: "cred-1", transports: ["internal"] },
    ]);
    expect(
      (
        await server.request("POST", "/authenticate/options", {
          user: "",
          body: { username: "user-2" },
        })
      ).status,
    ).toBe(404);
  });

  it("refuses a passkey that belongs to another user than asked for", async () => {
    server = await startServer();
    await registerPasskey(server);
    const options = await server.request("POST", "/authenticate/options", {
      user: "",
      body: { username: "user-1" },
    });
    server.db.sqlite.exec(
      "UPDATE p_webauthn_credentials SET user_id = 'user-2'",
    );
    await expect(
      passkeyMethod(server).verify!(
        {
          body: {
            challengeId: options.body.challengeId,
            response: { id: "cred-1" },
          },
          query: {},
          headers: {},
        },
        null,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("refuses an unknown passkey and a failed assertion", async () => {
    server = await startServer();
    await expect(loginWith(server)).rejects.toMatchObject({ status: 401 });
    await registerPasskey(server);
    webauthn.verifyAuthentication.mockRejectedValue(new Error("bad sig"));
    await expect(loginWith(server)).rejects.toMatchObject({ status: 401 });
  });

  it("uses a challenge only once", async () => {
    server = await startServer();
    await registerPasskey(server);
    const options = await server.request("POST", "/authenticate/options", {
      user: "",
      body: {},
    });
    const request = {
      body: {
        challengeId: options.body.challengeId,
        response: { id: "cred-1" },
      },
      query: {},
      headers: {},
    };
    await passkeyMethod(server).verify!(request, null);
    await expect(
      passkeyMethod(server).verify!(request, null),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("adoption", () => {
  const LEGACY = `
    CREATE TABLE webauthn_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      user_verification TEXT NOT NULL DEFAULT 'preferred',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );`;

  it("keeps existing passkeys, which still sign in", async () => {
    server = await startServer({
      before: (sqlite) => {
        sqlite
          .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
          .run("old-user", "old-user");
        sqlite.exec(LEGACY);
        sqlite.exec(`INSERT INTO webauthn_credentials
          (id, user_id, name, credential_id, public_key, counter, transports)
          VALUES ('p1', 'old-user', 'Old key', 'cred-1', 'AQID', 3, '[]')`);
      },
    });
    const tables = server.db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toContain("p_webauthn_credentials");
    expect(tables).not.toContain("webauthn_credentials");
    expect(await loginWith(server)).toMatchObject({ userId: "old-user" });
  });

  it("creates the table on a fresh install", async () => {
    server = await startServer();
    expect(
      server.db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM p_webauthn_credentials")
        .get(),
    ).toEqual({ n: 0 });
  });
});

describe("capabilities", () => {
  it("fails closed without auth:provide", async () => {
    await expect(
      startServer({
        capabilities: [
          "db:own",
          "network:serve",
          "settings:read-core",
          "ui:surface",
        ],
      }),
    ).rejects.toThrow(/auth:provide/);
  });

  it("fails closed without network:serve", async () => {
    await expect(
      startServer({
        capabilities: [
          "db:own",
          "auth:provide",
          "settings:read-core",
          "ui:surface",
        ],
      }),
    ).rejects.toThrow(/network:serve/);
  });
});

describe("requestOrigin", () => {
  it("prefers Origin, then forwarded host and proto", () => {
    expect(requestOrigin({ origin: "https://a.test" })).toBe("https://a.test");
    expect(
      requestOrigin({
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "b.test",
        host: "internal",
      }),
    ).toBe("https://b.test");
    expect(requestOrigin({ host: "c.test:8080" })).toBe("http://c.test:8080");
  });
});
