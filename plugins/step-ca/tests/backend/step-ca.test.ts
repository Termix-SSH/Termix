import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { createMockCtx, createTestDb } from "@termix/plugin-sdk/testing";
import { CA_URL, createFakeCa } from "./fake-ca.js";
import {
  HOST,
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
let nonce = "";

beforeEach(() => {
  certs.applyCertificateAuth.mockReset();
  nonce = "";
});

afterEach(async () => {
  await server?.close();
  server = null;
});

async function startWithCa(
  options: {
    principals?: string[];
    signStatus?: number;
    wrongNonce?: boolean;
    settings?: Record<string, unknown>;
  } = {},
) {
  const ca = createFakeCa({
    principals: options.principals,
    signStatus: options.signStatus,
    nonce: () => (options.wrongNonce ? "other" : nonce),
  });
  server = await startServer({
    fetch: ca.fetch,
    settings: {
      caUrl: CA_URL,
      fingerprint: ca.root.fingerprint,
      provisioner: "oidc",
      ...options.settings,
    },
  });
  return ca;
}

/** Starts a sign-in and returns the socket and the authorization URL. */
async function startSignIn() {
  const socket = fakeSocket();
  await server!.provider().startInteraction!({
    userId: "user-1",
    hostId: 7,
    host: { name: "box", ip: "10.0.0.7", username: "root" },
    socket: socket.socket,
    requestOrigin: "https://termix.test",
    payload: {},
  });
  const chooser = socket.sent.find((m) => m.stage === "chooser");
  const url = chooser ? new URL(String(chooser.url)) : null;
  nonce = url?.searchParams.get("nonce") ?? "";
  return { socket, url, state: url?.searchParams.get("state") ?? "" };
}

describe("the certs table", () => {
  it("is created on a fresh install", async () => {
    const db = await createTestDb(pluginDir);
    expect(
      db.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'p_step_ca_certs'",
        )
        .get(),
    ).toBeTruthy();
    db.close();
  });
});

describe("activate", () => {
  it("registers the stepca auth type and its callback route", async () => {
    server = await startServer();
    expect(server.provider()).toMatchObject({
      type: "stepca",
      interaction: "stepca",
      supportsBackground: false,
    });
    expect(server.mock.httpRouters).toHaveLength(1);
  });

  it.each(["db:own", "auth:provide", "network:serve"])(
    "fails closed without %s",
    async (capability) => {
      const mock = createMockCtx({
        pluginId: manifest.id,
        manifest,
        capabilities: manifest.capabilities.filter((c) => c !== capability),
        db: (await createTestDb(pluginDir)).database,
      });
      const { activate } = await import("../../src/backend/index.js");
      await expect(activate(mock.ctx)).rejects.toThrow(PluginCapabilityError);
    },
  );
});

describe("issuing a certificate", () => {
  it("runs the OIDC flow against the CA and stores the certificate sealed", async () => {
    const ca = await startWithCa();
    const { socket, url, state } = await startSignIn();

    expect(url?.origin + url?.pathname).toBe("https://idp.test/authorize");
    expect(url?.searchParams.get("client_id")).toBe("termix");
    expect(url?.searchParams.get("redirect_uri")).toBe(
      "https://termix.test/plugin-api/step-ca/callback",
    );
    expect(url?.searchParams.get("code_challenge_method")).toBe("S256");

    // The root is fetched unverified and checked by fingerprint, then pinned.
    expect(ca.calls[0].init?.tls).toEqual({ rejectUnauthorized: false });
    expect(ca.calls[1].init?.tls).toEqual({ ca: ca.root.pem });

    const response = await server!.get(`/callback?state=${state}&code=abc`);
    expect(response.status).toBe(200);
    expect(response.body).toContain("Signed in");
    expect(socket.sent.at(-1)).toMatchObject({
      type: "stepca_completed",
      requestId: state,
    });

    const sign = ca.calls.find((call) => call.url.endsWith("/1.0/ssh/sign"));
    expect(JSON.parse(sign!.init!.body!)).toMatchObject({
      certType: "user",
      principals: ["root"],
      keyID: "alice@example.com",
    });
    expect(sign!.init!.tls).toEqual({ ca: ca.root.pem });

    const row = server!.db.sqlite
      .prepare("SELECT * FROM p_step_ca_certs")
      .get() as Record<string, string>;
    expect(row.user_id).toBe("user-1");
    expect(row.email).toBe("alice@example.com");
    expect(row.ssh_cert).toMatch(/^sealed:/);
    expect(row.private_key).toMatch(/^sealed:/);
  });

  it("answers a second use of the same callback with an error", async () => {
    await startWithCa();
    const { state } = await startSignIn();
    await server!.get(`/callback?state=${state}&code=abc`);
    const again = await server!.get(`/callback?state=${state}&code=abc`);
    expect(again.status).toBe(400);
    expect(again.body).toContain("no longer active");
  });

  it("refuses an id token issued for another sign-in", async () => {
    await startWithCa({ wrongNonce: true });
    const { socket, state } = await startSignIn();
    const response = await server!.get(`/callback?state=${state}&code=abc`);
    expect(response.status).toBe(400);
    expect(socket.sent.at(-1)).toMatchObject({
      type: "stepca_error",
      error: expect.stringContaining("does not match"),
    });
    expect(
      server!.db.sqlite.prepare("SELECT * FROM p_step_ca_certs").all(),
    ).toHaveLength(0);
  });

  it("reports the CA refusing to sign", async () => {
    await startWithCa({ signStatus: 403 });
    const { socket, state } = await startSignIn();
    await server!.get(`/callback?state=${state}&code=abc`);
    expect(socket.sent.at(-1)).toMatchObject({
      type: "stepca_error",
      error: expect.stringContaining("HTTP 403"),
    });
  });

  it("rejects a certificate without the host username", async () => {
    await startWithCa({ principals: ["someone-else"] });
    const { socket, state } = await startSignIn();
    await server!.get(`/callback?state=${state}&code=abc`);
    expect(socket.sent.at(-1)).toMatchObject({
      type: "stepca_error",
      error: expect.stringContaining("host username"),
    });
  });

  it("passes an identity provider error through", async () => {
    await startWithCa();
    const { socket, state } = await startSignIn();
    const response = await server!.get(
      `/callback?state=${state}&error=access_denied&error_description=Denied`,
    );
    expect(response.status).toBe(400);
    expect(socket.sent.at(-1)).toMatchObject({
      type: "stepca_error",
      error: "Step CA: Denied",
    });
  });

  it("sends the 2.8 redirect URI while legacyCallback is on", async () => {
    await startWithCa({ settings: { legacyCallback: true } });
    const { url } = await startSignIn();
    expect(url?.searchParams.get("redirect_uri")).toBe(
      "https://termix.test/host/step-ca-callback",
    );
  });

  it("tells the terminal when Step CA is not configured", async () => {
    server = await startServer();
    const { socket } = await startSignIn();
    expect(socket.sent).toEqual([
      expect.objectContaining({ type: "stepca_config_error" }),
    ]);
  });

  it("lets a pending sign-in be cancelled", async () => {
    await startWithCa();
    const { state } = await startSignIn();
    await server!.provider().cancelInteraction!({
      userId: "user-1",
      requestId: state,
    });
    const response = await server!.get(`/callback?state=${state}&code=abc`);
    expect(response.status).toBe(400);
  });
});

describe("the stepca provider", () => {
  it("asks for a sign-in without a certificate", async () => {
    server = await startServer();
    const outcome = await server.provider().prepare({}, HOST, env());
    expect(outcome).toMatchObject({
      status: "interaction-required",
      interaction: "stepca",
    });
    expect(certs.applyCertificateAuth).not.toHaveBeenCalled();
  });

  it("connects with the issued certificate", async () => {
    await startWithCa();
    const { state } = await startSignIn();
    await server!.get(`/callback?state=${state}&code=abc`);

    const config: Record<string, unknown> = {};
    const outcome = await server!.provider().prepare(config, HOST, env());
    expect(outcome).toEqual({ status: "ready" });
    const [passedConfig, , credentials, username] =
      certs.applyCertificateAuth.mock.calls[0];
    expect(passedConfig).toBe(config);
    expect(username).toBe("root");
    expect(credentials.certificate).toMatch(
      /^ssh-ed25519-cert-v01@openssh\.com /,
    );
    expect(credentials.privateKey).toContain("BEGIN PRIVATE KEY");
  });

  it("forgets an expired certificate", async () => {
    await startWithCa();
    const { state } = await startSignIn();
    await server!.get(`/callback?state=${state}&code=abc`);
    server!.db.sqlite
      .prepare("UPDATE p_step_ca_certs SET expires_at = ?")
      .run("2000-01-01T00:00:00.000Z");
    const outcome = await server!.provider().prepare({}, HOST, env());
    expect(outcome.status).toBe("interaction-required");
    expect(
      server!.db.sqlite.prepare("SELECT * FROM p_step_ca_certs").all(),
    ).toHaveLength(0);
  });

  it("drops the certificate when the host rejects it", async () => {
    await startWithCa();
    const { state } = await startSignIn();
    await server!.get(`/callback?state=${state}&code=abc`);
    const decision = server!.provider().onAuthFailed!(HOST, env(), {
      error: new Error("All configured authentication methods failed"),
    } as never);
    expect(decision).toMatchObject({ status: "interaction-required" });
    await vi.waitFor(() =>
      expect(
        server!.db.sqlite.prepare("SELECT * FROM p_step_ca_certs").all(),
      ).toHaveLength(0),
    );
  });
});
