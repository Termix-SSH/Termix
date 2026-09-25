import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { createMockCtx, createTestDb } from "@termix/plugin-sdk/testing";
import {
  HOST,
  PROFILE,
  SIGNED_CERT,
  VAULT_ADDR,
  createFakeVault,
  env,
  fakeSocket,
  manifest,
  pluginDir,
  startServer,
  type TestServer,
} from "./helpers.js";

const certs = vi.hoisted(() => ({ applyCertificateAuth: vi.fn() }));
vi.mock("@termix/plugin-sdk/ssh-certs", () => certs);

let server: TestServer | null = null;

beforeEach(() => {
  certs.applyCertificateAuth.mockReset();
});

afterEach(async () => {
  await server?.close();
  server = null;
});

/** Creates a profile as user-1 and points host 7 at it. */
async function profileOnHost(options: { shared?: boolean } = {}) {
  const created = await server!.request("POST", "/profiles", {
    body: { ...PROFILE, shared: options.shared ?? false },
  });
  expect(created.status).toBe(201);
  await server!.mock.ctx.settings.setHost(7, "profileId", created.body.id);
  return created.body as { id: number };
}

async function startSignIn(userId = "user-1") {
  const socket = fakeSocket();
  await server!.provider().startInteraction!({
    userId,
    hostId: 7,
    host: { name: "box", ip: HOST.ip, username: HOST.username },
    socket: socket.socket,
    requestOrigin: "https://termix.test",
    payload: {},
  });
  return socket;
}

describe("activate", () => {
  it("registers the vault auth type, the sync entity and a public callback", async () => {
    server = await startServer();
    const provider = server.provider();
    expect(provider).toMatchObject({
      type: "vault",
      interaction: "vault",
      needsUserInteraction: true,
      supportsBackground: false,
    });
    expect(server.mock.syncEntities).toEqual([
      expect.objectContaining({ type: "vaultProfiles", order: 20 }),
    ]);
    expect(server.mock.httpRouters[0]?.public).toEqual(["/oidc/callback"]);
  });

  // secrets:own and network:outbound are checked when used, ui:surface by the
  // frontend.
  it.each(["db:own", "network:serve", "auth:provide"])(
    "fails closed without %s",
    async (capability) => {
      const db = await createTestDb(pluginDir);
      const mock = createMockCtx({
        pluginId: manifest.id,
        manifest,
        capabilities: manifest.capabilities.filter((c) => c !== capability),
        db: db.database,
        router: () => ({ get: () => {}, use: () => {} }),
      });
      const { activate } = await import("../../src/backend/index.js");
      await expect(activate(mock.ctx)).rejects.toThrow(PluginCapabilityError);
      db.close();
    },
  );
});

describe("profiles", () => {
  it("creates, lists, updates and deletes a profile", async () => {
    server = await startServer();
    const created = await server.request("POST", "/profiles", {
      body: { ...PROFILE, vaultNamespace: " team ", tags: ["a", "b"] },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Prod",
      vaultAddr: VAULT_ADDR,
      vaultNamespace: "team",
      sshRole: "ops",
      tags: ["a", "b"],
      shared: false,
      owned: true,
    });

    const listed = await server.request("GET", "/profiles");
    expect(listed.body).toHaveLength(1);

    const updated = await server.request(
      "PUT",
      `/profiles/${created.body.id}`,
      { body: { name: "Staging", keyType: "ssh-rsa" } },
    );
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: "Staging", keyType: "ssh-rsa" });

    const deleted = await server.request(
      "DELETE",
      `/profiles/${created.body.id}`,
    );
    expect(deleted.status).toBe(200);
    expect((await server.request("GET", "/profiles")).body).toEqual([]);
  });

  it("records a tombstone and drops cached certificates on delete", async () => {
    server = await startServer();
    const { id } = await profileOnHost();
    server.db.sqlite
      .prepare(
        "INSERT INTO p_vault_tokens (user_id, profile_id, ssh_cert, private_key, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("user-1", id, "c", "k", "2999-01-01T00:00:00.000Z");
    const syncId = (
      server.db.sqlite
        .prepare("SELECT sync_id FROM p_vault_profiles WHERE id = ?")
        .get(id) as { sync_id: string }
    ).sync_id;

    await server.request("DELETE", `/profiles/${id}`);

    expect(server.mock.tombstones).toEqual([
      { userId: "user-1", entityType: "vaultProfiles", syncId },
    ]);
    expect(
      server.db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM p_vault_tokens")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("requires name, address and signer role", async () => {
    server = await startServer();
    const response = await server.request("POST", "/profiles", {
      body: { name: "x" },
    });
    expect(response.status).toBe(400);
  });

  it("shows other users only shared profiles, and only the owner may change one", async () => {
    server = await startServer();
    const own = await server.request("POST", "/profiles", { body: PROFILE });
    const shared = await server.request("POST", "/profiles", {
      body: { ...PROFILE, name: "Shared", shared: true },
    });

    const seen = await server.request("GET", "/profiles", { user: "user-2" });
    expect(seen.body.map((p: { name: string }) => p.name)).toEqual(["Shared"]);
    expect(seen.body[0].owned).toBe(false);

    for (const id of [own.body.id, shared.body.id]) {
      const put = await server.request("PUT", `/profiles/${id}`, {
        user: "user-2",
        body: { name: "mine" },
      });
      expect(put.status).toBe(403);
      const del = await server.request("DELETE", `/profiles/${id}`, {
        user: "user-2",
      });
      expect(del.status).toBe(403);
    }
  });

  it("needs the share permission to share a profile", async () => {
    server = await startServer({ permissions: ["vault.use"] });
    const create = await server.request("POST", "/profiles", {
      body: { ...PROFILE, shared: true },
    });
    expect(create.status).toBe(403);

    const own = await server.request("POST", "/profiles", { body: PROFILE });
    expect(own.status).toBe(201);
    const share = await server.request("PUT", `/profiles/${own.body.id}`, {
      body: { shared: true },
    });
    expect(share.status).toBe(403);
    const unshare = await server.request("PUT", `/profiles/${own.body.id}`, {
      body: { shared: false },
    });
    expect(unshare.status).toBe(200);
  });

  it("refuses every profile route without the use permission", async () => {
    server = await startServer({ permissions: [] });
    for (const [method, path] of [
      ["GET", "/profiles"],
      ["POST", "/profiles"],
      ["PUT", "/profiles/1"],
      ["DELETE", "/profiles/1"],
    ]) {
      const response = await server.request(method, path, {
        body: method === "GET" ? undefined : PROFILE,
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("answers 404 for a profile that does not exist", async () => {
    server = await startServer();
    expect(
      (await server.request("PUT", "/profiles/99", { body: {} })).status,
    ).toBe(404);
    expect((await server.request("DELETE", "/profiles/99")).status).toBe(404);
    expect((await server.request("DELETE", "/profiles/abc")).status).toBe(400);
  });
});

describe("signing a certificate", () => {
  it("runs the OIDC flow against Vault and stores the certificate sealed", async () => {
    const vault = createFakeVault();
    server = await startServer({ fetch: vault.fetch });
    const { id } = await profileOnHost();

    const socket = await startSignIn();
    expect(socket.sent).toEqual([
      expect.objectContaining({
        type: "vault_auth_url",
        hostId: 7,
        requestId: vault.state,
        url: expect.stringContaining("https://idp.test/authorize"),
      }),
    ]);
    const authUrlCall = vault.calls[0];
    expect(JSON.parse(String(authUrlCall.init?.body))).toMatchObject({
      role: "dev",
      redirect_uri: "https://termix.test/plugin-api/vault/oidc/callback",
    });
    expect(authUrlCall.init?.allowPrivateHosts).toEqual(["vault.internal"]);

    const callback = await server.request(
      "GET",
      `/oidc/callback?state=${vault.state}&code=abc`,
      { user: "" },
    );
    expect(callback.status).toBe(200);
    expect(callback.text).toContain("Vault sign-in complete");
    expect(socket.sent.at(-1)).toMatchObject({
      type: "vault_completed",
      hostId: 7,
    });

    const signCall = vault.calls.find((call) => call.url.includes("/sign/"));
    expect(signCall?.url).toBe(`${VAULT_ADDR}/v1/ssh-client-signer/sign/ops`);
    expect(signCall?.init?.headers?.["X-Vault-Token"]).toBe("hvs.token");

    const row = server.db.sqlite
      .prepare("SELECT * FROM p_vault_tokens WHERE profile_id = ?")
      .get(id) as { ssh_cert: string; private_key: string };
    expect(row.ssh_cert).not.toBe(SIGNED_CERT);
    expect(await server.mock.ctx.secrets.unseal(row.ssh_cert)).toBe(
      SIGNED_CERT,
    );
    expect(await server.mock.ctx.secrets.unseal(row.private_key)).toContain(
      "OPENSSH PRIVATE KEY",
    );

    const outcome = await server.provider().prepare({}, HOST, env());
    expect(outcome).toEqual({ status: "ready" });
    expect(certs.applyCertificateAuth).toHaveBeenCalledWith(
      {},
      {},
      expect.objectContaining({ certificate: SIGNED_CERT }),
      "root",
    );
  });

  it("answers a second use of the same callback with an error", async () => {
    const vault = createFakeVault();
    server = await startServer({ fetch: vault.fetch });
    await profileOnHost();
    await startSignIn();
    const path = `/oidc/callback?state=${vault.state}&code=abc`;
    expect((await server.request("GET", path)).status).toBe(200);
    expect((await server.request("GET", path)).status).toBe(400);
  });

  it("reports Vault refusing to sign", async () => {
    const vault = createFakeVault({ signStatus: 403 });
    server = await startServer({ fetch: vault.fetch });
    await profileOnHost();
    const socket = await startSignIn();
    const callback = await server.request(
      "GET",
      `/oidc/callback?state=${vault.state}&code=abc`,
    );
    expect(callback.status).toBe(400);
    expect(socket.sent.at(-1)).toMatchObject({
      type: "vault_error",
      error: expect.stringContaining("permission denied"),
    });
  });

  it("passes an identity provider error through", async () => {
    server = await startServer();
    const callback = await server.request(
      "GET",
      "/oidc/callback?error=access_denied",
    );
    expect(callback.status).toBe(400);
    expect(callback.text).toContain("access_denied");
  });

  it("sends the 2.8 redirect URI while legacyCallback is on", async () => {
    const vault = createFakeVault();
    server = await startServer({
      fetch: vault.fetch,
      settings: { legacyCallback: true },
    });
    await profileOnHost();
    await startSignIn();
    expect(JSON.parse(String(vault.calls[0].init?.body)).redirect_uri).toBe(
      "https://termix.test/vault/oidc/callback",
    );
  });

  it("lets a pending sign-in be cancelled", async () => {
    const vault = createFakeVault();
    server = await startServer({ fetch: vault.fetch });
    await profileOnHost();
    await startSignIn();
    await server.provider().cancelInteraction!({ userId: "user-1", hostId: 7 });
    const callback = await server.request(
      "GET",
      `/oidc/callback?state=${vault.state}&code=abc`,
    );
    expect(callback.status).toBe(400);
  });

  it("refuses to start without a profile on the host", async () => {
    server = await startServer();
    await expect(startSignIn()).rejects.toThrow(/No Vault signer profile/);
  });
});

describe("the vault provider", () => {
  it("fails without a profile on the host", async () => {
    server = await startServer();
    expect(await server.provider().prepare({}, HOST, env())).toMatchObject({
      status: "error",
      message: "Host has no Vault signer profile configured",
    });
  });

  it("asks for a sign-in without a certificate", async () => {
    server = await startServer();
    await profileOnHost();
    expect(await server.provider().prepare({}, HOST, env())).toEqual({
      status: "interaction-required",
      interaction: "vault",
      message: expect.any(String),
      flag: "requiresVaultAuth",
    });
  });

  it("uses a profile another user shared with the host's owner", async () => {
    server = await startServer();
    const shared = await server.request("POST", "/profiles", {
      user: "user-2",
      body: { ...PROFILE, shared: true },
    });
    await server.mock.ctx.settings.setHost(7, "profileId", shared.body.id);
    expect((await server.provider().prepare({}, HOST, env())).status).toBe(
      "interaction-required",
    );
  });

  it("drops a certificate 2.8 cached with the user's data key", async () => {
    server = await startServer();
    const { id } = await profileOnHost();
    server.db.sqlite
      .prepare(
        "INSERT INTO p_vault_tokens (user_id, profile_id, ssh_cert, private_key, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "user-1",
        id,
        "v1:dek-cipher",
        "v1:dek-cipher",
        "2999-01-01T00:00:00.000Z",
      );

    const outcome = await server.provider().prepare({}, HOST, env());
    expect(outcome.status).toBe("interaction-required");
    expect(
      server.db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM p_vault_tokens")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("forgets an expired certificate", async () => {
    server = await startServer();
    const { id } = await profileOnHost();
    const seal = server.mock.ctx.secrets.seal;
    server.db.sqlite
      .prepare(
        "INSERT INTO p_vault_tokens (user_id, profile_id, ssh_cert, private_key, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "user-1",
        id,
        await seal("c"),
        await seal("k"),
        "2000-01-01T00:00:00.000Z",
      );
    expect((await server.provider().prepare({}, HOST, env())).status).toBe(
      "interaction-required",
    );
    expect(
      server.db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM p_vault_tokens")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("drops the certificate when the host rejects it", async () => {
    const vault = createFakeVault();
    server = await startServer({ fetch: vault.fetch });
    await profileOnHost();
    await startSignIn();
    await server.request("GET", `/oidc/callback?state=${vault.state}&code=abc`);

    const outcome = server.provider().onAuthFailed!(HOST, env(), {
      error: new Error("All configured authentication methods failed"),
      retries: 0,
      canRetry: false,
      methodNotAvailable: false,
    });
    expect(outcome).toMatchObject({ status: "interaction-required" });
    await vi.waitFor(() =>
      expect(
        server!.db.sqlite
          .prepare("SELECT COUNT(*) AS n FROM p_vault_tokens")
          .get(),
      ).toEqual({ n: 0 }),
    );
  });

  it("ignores other auth failures", async () => {
    server = await startServer();
    expect(
      server.provider().onAuthFailed!(HOST, env(), {
        error: new Error("connection reset"),
        retries: 0,
        canRetry: false,
        methodNotAvailable: false,
      }),
    ).toBeUndefined();
  });
});
