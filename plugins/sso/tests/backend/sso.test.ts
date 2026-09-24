import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_DDL,
  OIDC_CONFIG,
  installIdp,
  startServer,
  type TestServer,
} from "./helpers.js";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A 2.8 database: one OIDC provider and one LDAP directory in one table. */
function legacyRows(
  sqlite: Parameters<
    NonNullable<Parameters<typeof startServer>[0]>["before"]
  >[0],
) {
  sqlite.exec(LEGACY_DDL);
  const insert = sqlite.prepare(
    "INSERT INTO sso_providers (id, name, type, enabled, config) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(3, "Keycloak", "oidc", 1, JSON.stringify(OIDC_CONFIG));
  insert.run(4, "Corp LDAP", "ldap", 1, '{"host":"ldap.example"}');
}

async function startLegacy(options: Parameters<typeof startServer>[0] = {}) {
  server = await startServer({ before: legacyRows, ...options });
  return server;
}

/** Runs /start and returns the state the provider would echo back. */
async function beginLogin(s: TestServer, query = "provider=3") {
  const started = await s.request("GET", `/start?${query}`, {
    headers: { referer: "https://app.termix.test/login" },
  });
  expect(started.status).toBe(302);
  return new URL(started.location!);
}

describe("adopting sso_providers", () => {
  it("keeps every provider and marks the old ones for the 2.8 redirect URI", async () => {
    const s = await startLegacy();
    const rows = s.db.sqlite
      .prepare(
        "SELECT id, type, legacy_callback FROM p_sso_providers ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      { id: 3, type: "oidc", legacy_callback: 1 },
      { id: 4, type: "ldap", legacy_callback: 1 },
    ]);

    const listed = await s.request("GET", "/providers");
    expect(listed.status).toBe(200);
    // LDAP rows are the ldap plugin's; they are not listed here.
    expect(listed.body.providers).toHaveLength(1);
    expect(listed.body.providers[0]).toMatchObject({
      id: 3,
      name: "Keycloak",
      legacyCallback: true,
      hasClientSecret: true,
      redirectUri: "https://termix.test/users/oidc/callback",
    });
    expect(listed.body.providers[0].config.client_secret).toBeUndefined();
    expect(listed.body.newRedirectUri).toBe(
      "https://termix.test/plugin-api/sso/callback",
    );
  });

  it("creates a fresh table on a new install", async () => {
    server = await startServer();
    const created = await server.request("POST", "/providers", {
      body: { name: "Keycloak", type: "oidc", config: OIDC_CONFIG },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      legacyCallback: false,
      redirectUri: "https://termix.test/plugin-api/sso/callback",
    });
    const stored = server.db.sqlite
      .prepare("SELECT config FROM p_sso_providers")
      .get() as { config: string };
    expect(JSON.parse(stored.config).client_secret).toMatch(/^sealed:/);
  });

  it("reads secrets 2.8 stored base64 encoded", async () => {
    server = await startServer({
      before: (sqlite) => {
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO sso_providers (id, name, type, config) VALUES (1, 'Old', 'oidc', ?)",
          )
          .run(
            JSON.stringify({
              ...OIDC_CONFIG,
              client_secret: `encoded:${Buffer.from("old-secret").toString("base64")}`,
            }),
          );
      },
    });
    const idp = await installIdp();
    idp.claims = { sub: "sub-1" };
    const url = await beginLogin(server, "provider=1");
    idp.claims.nonce = url.searchParams.get("nonce");
    await server.request(
      "GET",
      `/callback?code=c&state=${url.searchParams.get("state")}`,
    );
    expect(idp.tokenRequests[0].get("client_secret")).toBe("old-secret");
  });
});

describe("provider admin routes", () => {
  it("need sso.manage", async () => {
    const s = await startLegacy({ permissions: [] });
    for (const [method, path] of [
      ["GET", "/providers"],
      ["POST", "/providers"],
      ["PUT", "/providers/3"],
      ["DELETE", "/providers/3"],
    ]) {
      expect((await s.request(method, path, { body: {} })).status).toBe(403);
    }
    // The public routes stay reachable.
    expect((await s.request("GET", "/config")).status).toBe(200);
  });

  it("keeps a secret that is not sent again and can leave the old redirect URI", async () => {
    const s = await startLegacy();
    const updated = await s.request("PUT", "/providers/3", {
      body: { legacyCallback: false, config: { client_secret: "" } },
    });
    expect(updated.body).toMatchObject({
      legacyCallback: false,
      hasClientSecret: true,
      redirectUri: "https://termix.test/plugin-api/sso/callback",
    });
  });

  it("validates a new provider", async () => {
    const s = await startLegacy();
    const missing = await s.request("POST", "/providers", {
      body: { name: "X", type: "oidc", config: { client_id: "a" } },
    });
    expect(missing.status).toBe(400);
    const userinfo = await s.request("POST", "/providers", {
      body: {
        name: "X",
        type: "oidc",
        config: { ...OIDC_CONFIG, issuer_url: "https://idp.example/userinfo" },
      },
    });
    expect(userinfo.status).toBe(400);
    const ldap = await s.request("POST", "/providers", {
      body: { name: "X", type: "ldap", config: {} },
    });
    expect(ldap.status).toBe(400);
  });

  it("will not delete a provider people still sign in with", async () => {
    const s = await startLegacy({ linkedUsers: { "3": 2 } });
    expect((await s.request("DELETE", "/providers/3")).status).toBe(409);
  });
});

describe("the login method", () => {
  it("offers one button per enabled provider", async () => {
    const s = await startLegacy();
    const method = s.mock.auth.loginMethods[0];
    expect(method).toMatchObject({
      id: "oidc",
      kind: "redirect",
      external: true,
    });
    expect(await method.describe!()).toEqual([
      { id: "3", label: "Keycloak", type: "oidc", enabled: true },
    ]);
  });

  it("falls back to the provider configured through the environment", async () => {
    server = await startServer();
    vi.stubEnv("OIDC_CLIENT_ID", "env-client");
    vi.stubEnv("OIDC_CLIENT_SECRET", "env-secret");
    vi.stubEnv("OIDC_ISSUER_URL", "https://idp.example");
    vi.stubEnv("OIDC_AUTHORIZATION_URL", "https://idp.example/authorize");
    vi.stubEnv("OIDC_TOKEN_URL", "https://idp.example/token");
    expect(await server.mock.auth.loginMethods[0].describe!()).toEqual([
      { id: "0", label: "SSO", type: "oidc", enabled: true },
    ]);
    const url = await beginLogin(server, "provider=0");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://termix.test/users/oidc/callback",
    );
  });

  it("starts with PKCE and the redirect URI the provider was set up with", async () => {
    const s = await startLegacy();
    const url = await beginLogin(s);
    expect(url.origin + url.pathname).toBe("https://idp.example/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://termix.test/users/oidc/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect([...s.mock.kv.keys()]).toEqual([
      `state:${url.searchParams.get("state")}`,
    ]);
  });

  it("answers 404 for a provider that does not exist", async () => {
    const s = await startLegacy();
    expect((await s.request("GET", "/start?provider=99")).status).toBe(404);
    // An LDAP row is not an SSO provider.
    expect((await s.request("GET", "/start?provider=4")).status).toBe(404);
  });
});

describe("the callback", () => {
  it("verifies the id token and hands core the identity", async () => {
    const s = await startLegacy();
    const idp = await installIdp();
    const url = await beginLogin(s);
    idp.claims = {
      sub: "sub-1",
      sid: "sid-1",
      name: "Alice",
      nonce: url.searchParams.get("nonce"),
      groups: ["termix-admins", "ops-team"],
    };

    const callback = await s.request(
      "GET",
      `/callback?code=abc&state=${url.searchParams.get("state")}`,
    );
    expect(callback.status).toBe(200);
    expect(callback.body.identity).toMatchObject({
      kind: "external",
      provider: "3",
      subject: "sub-1",
      name: "Alice",
      email: "alice@example.com",
      isAdmin: true,
      roles: { desired: ["ops"], managed: ["ops"] },
      logoutClaims: { providerId: 3, sub: "sub-1", sid: "sid-1" },
      legacy: { identifier: "sub-1", providerRowId: 3 },
      returnTo: "https://app.termix.test",
    });

    const token = idp.tokenRequests[0];
    expect(token.get("redirect_uri")).toBe(
      "https://termix.test/users/oidc/callback",
    );
    expect(token.get("code_verifier")).toBeTruthy();
    // The state is used up.
    expect(s.mock.kv.size).toBe(0);
  });

  it("accepts the provider's answer as a form post", async () => {
    const s = await startLegacy();
    const idp = await installIdp();
    const url = await beginLogin(s);
    idp.claims = { sub: "sub-1", nonce: url.searchParams.get("nonce") };
    const callback = await s.request("POST", "/callback", {
      form: { code: "abc", state: url.searchParams.get("state")! },
    });
    expect(callback.body.identity.subject).toBe("sub-1");
  });

  it("sends the user back with an error on a nonce mismatch", async () => {
    const s = await startLegacy();
    const idp = await installIdp();
    const url = await beginLogin(s);
    idp.claims = { sub: "sub-1", nonce: "someone-elses" };
    const callback = await s.request(
      "GET",
      `/callback?code=abc&state=${url.searchParams.get("state")}`,
    );
    expect(callback.status).toBe(302);
    expect(callback.location).toMatch(/^https:\/\/app\.termix\.test\/\?error=/);
    expect(s.mock.auth.completedLogins).toHaveLength(0);
  });

  it("refuses an unknown or replayed state", async () => {
    const s = await startLegacy();
    const idp = await installIdp();
    const url = await beginLogin(s);
    idp.claims = { sub: "sub-1", nonce: url.searchParams.get("nonce") };
    const state = url.searchParams.get("state");
    expect(
      (await s.request("GET", `/callback?code=a&state=${state}`)).status,
    ).toBe(200);
    expect(
      (await s.request("GET", `/callback?code=a&state=${state}`)).status,
    ).toBe(400);
    expect((await s.request("GET", "/callback?code=a&state=nope")).status).toBe(
      400,
    );
  });

  it("signs GitHub users in by their numeric id", async () => {
    server = await startServer();
    const created = await server.request("POST", "/providers", {
      body: {
        name: "GitHub",
        type: "github",
        config: { client_id: "gh", client_secret: "gh-secret" },
      },
    });
    const idp = await installIdp();
    idp.routes.set("https://github.com/login/oauth/access_token", () =>
      Response.json({ access_token: "gh-token" }),
    );
    idp.routes.set("https://api.github.com/user", () =>
      Response.json({ id: 42, login: "octo" }),
    );
    idp.routes.set("https://api.github.com/user/emails", () =>
      Response.json([
        { email: "octo@example.com", primary: true, verified: true },
      ]),
    );
    const url = await beginLogin(server, `provider=${created.body.id}`);
    const callback = await server.request(
      "GET",
      `/callback?code=abc&state=${url.searchParams.get("state")}`,
    );
    expect(callback.body.identity).toMatchObject({
      provider: String(created.body.id),
      subject: "42",
      name: "octo",
      email: "octo@example.com",
      legacy: { identifier: `github:${created.body.id}:42` },
    });
  });
});

describe("back-channel logout", () => {
  const event = {
    "http://schemas.openid.net/event/backchannel-logout": {},
  };

  it("ends the sessions from that provider login, once per token", async () => {
    const s = await startLegacy();
    const idp = await installIdp();
    const token = await idp.sign({ sid: "sid-1", jti: "j1", events: event });

    const first = await s.request("POST", "/backchannel-logout", {
      form: { logout_token: token },
    });
    expect(first.status).toBe(200);
    expect(s.mock.auth.revokedSessions).toEqual([
      { providerId: 3, sub: null, sid: "sid-1" },
    ]);

    const replay = await s.request("POST", "/backchannel-logout", {
      form: { logout_token: token },
    });
    expect(replay.status).toBe(200);
    expect(s.mock.auth.revokedSessions).toHaveLength(1);
  });

  it("refuses a token that is missing, unsigned or from an unknown issuer", async () => {
    const s = await startLegacy();
    const idp = await installIdp();
    expect(
      (await s.request("POST", "/backchannel-logout", { form: {} })).status,
    ).toBe(400);
    const withNonce = await idp.sign({
      sid: "s",
      jti: "j2",
      nonce: "n",
      events: event,
    });
    expect(
      (
        await s.request("POST", "/backchannel-logout", {
          form: { logout_token: withNonce },
        })
      ).status,
    ).toBe(400);
    const header = Buffer.from('{"alg":"none"}').toString("base64url");
    const body = Buffer.from('{"iss":"https://elsewhere.example"}').toString(
      "base64url",
    );
    expect(
      (
        await s.request("POST", "/backchannel-logout", {
          form: { logout_token: `${header}.${body}.x` },
        })
      ).status,
    ).toBe(400);
    expect(s.mock.auth.revokedSessions).toHaveLength(0);
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

  it("cannot start a login without kv:own", async () => {
    const { manifest } = await import("./helpers.js");
    const s = await startLegacy({
      capabilities: manifest.capabilities.filter((c) => c !== "kv:own"),
    });
    expect((await s.request("GET", "/start?provider=3")).status).toBe(500);
  });
});
