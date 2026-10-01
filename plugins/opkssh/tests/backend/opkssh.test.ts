import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { createMockCtx, createTestDb } from "@termix/plugin-sdk/testing";
import {
  HOST,
  LEGACY_DDL,
  PROVIDERS_CONFIG,
  env,
  fakeSocket,
  manifest,
  pluginDir,
  startServer,
  type TestServer,
} from "./helpers.js";

const certs = vi.hoisted(() => ({ applyCertificateAuth: vi.fn() }));
vi.mock("@termix/plugin-sdk/ssh-certs", () => certs);

const KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAA
-----END OPENSSH PRIVATE KEY-----`;
const CERT = "ssh-ed25519-cert-v01@openssh.com AAAAC3NzaC1lZDI1NTE5";

let server: TestServer | null = null;

beforeEach(() => {
  certs.applyCertificateAuth.mockReset();
});

afterEach(async () => {
  await server?.close();
  server = null;
});

async function writeConfig(content = PROVIDERS_CONFIG) {
  await fs.writeFile(path.join(server!.dataDir, "config.yml"), content);
}

/** Starts a sign-in and returns its request id and what the socket saw. */
async function startSignIn(origin = "https://termix.test") {
  const socket = fakeSocket();
  await server!.provider().startInteraction!({
    userId: "user-1",
    hostId: 7,
    host: { name: "box", ip: "10.0.0.7", username: "root" },
    socket: socket.socket,
    requestOrigin: origin,
    payload: {},
  });
  return socket;
}

describe("adopting opkssh_tokens", () => {
  it("keeps the 2.8 rows and the unique index", async () => {
    const db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (7)");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO opkssh_tokens (user_id, host_id, ssh_cert, private_key, expires_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("user-1", 7, "cert", "key", "2099-01-01T00:00:00.000Z");
      },
    });
    const rows = db.sqlite.prepare("SELECT * FROM p_opkssh_tokens").all();
    expect(rows).toHaveLength(1);
    expect(() =>
      db.sqlite
        .prepare(
          "INSERT INTO p_opkssh_tokens (user_id, host_id, ssh_cert, private_key, expires_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("user-1", 7, "c", "k", "2099-01-01T00:00:00.000Z"),
    ).toThrow(/UNIQUE/);
    expect(
      db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE name = 'opkssh_tokens'")
        .get(),
    ).toBeUndefined();
    db.close();
  });

  it("creates the table on a fresh install", async () => {
    const db = await createTestDb(pluginDir);
    expect(
      db.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'p_opkssh_tokens'",
        )
        .get(),
    ).toBeTruthy();
    db.close();
  });
});

describe("activate", () => {
  it("registers the opkssh auth type and its routes", async () => {
    server = await startServer();
    expect(server.provider()).toMatchObject({
      type: "opkssh",
      interaction: "opkssh",
      supportsBackground: false,
    });
    expect(server.mock.httpRouters).toHaveLength(1);
    expect(server.mock.binaries[0]?.name).toMatch(/^opkssh-/);
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

describe("the opkssh provider", () => {
  it("asks for a sign-in without a cached certificate", async () => {
    server = await startServer();
    const outcome = await server.provider().prepare({}, HOST, env());
    expect(outcome).toMatchObject({
      status: "interaction-required",
      interaction: "opkssh",
      flag: "requiresOPKSSHAuth",
    });
  });

  it("connects with the certificate a sign-in stored", async () => {
    server = await startServer();
    await writeConfig();
    await startSignIn();
    server.processes[0].emitStdout(`${KEY}\n${CERT}\n`);
    await vi.waitFor(() =>
      expect(
        server!.db.sqlite.prepare("SELECT * FROM p_opkssh_tokens").all(),
      ).toHaveLength(1),
    );

    const config: Record<string, unknown> = {};
    const outcome = await server.provider().prepare(config, HOST, env());
    expect(outcome).toEqual({ status: "ready" });
    expect(certs.applyCertificateAuth).toHaveBeenCalledWith(
      config,
      {},
      { privateKey: KEY, certificate: CERT },
      "root",
    );
    const row = server.db.sqlite
      .prepare("SELECT ssh_cert FROM p_opkssh_tokens")
      .get() as { ssh_cert: string };
    expect(row.ssh_cert).not.toContain("cert-v01");
  });

  it("treats a 2.8 row it cannot unseal as expired", async () => {
    server = await startServer({
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (7)");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO opkssh_tokens (user_id, host_id, ssh_cert, private_key, expires_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("user-1", 7, "v2:old", "v2:old", "2099-01-01T00:00:00.000Z");
      },
    });
    const outcome = await server.provider().prepare({}, HOST, env());
    expect(outcome.status).toBe("interaction-required");
    expect(
      server.db.sqlite.prepare("SELECT * FROM p_opkssh_tokens").all(),
    ).toHaveLength(0);
  });

  it("forgets the certificate when the server refuses it", async () => {
    server = await startServer();
    await writeConfig();
    await startSignIn();
    server.processes[0].emitStdout(`${KEY}\n${CERT}\n`);
    await vi.waitFor(() =>
      expect(
        server!.db.sqlite.prepare("SELECT * FROM p_opkssh_tokens").all(),
      ).toHaveLength(1),
    );
    const followUp = server.provider().onAuthFailed!(HOST, env(), {
      error: new Error("All configured authentication methods failed"),
      retries: 0,
      canRetry: true,
      methodNotAvailable: false,
    });
    expect(followUp).toMatchObject({ status: "interaction-required" });
    await vi.waitFor(() =>
      expect(
        server!.db.sqlite.prepare("SELECT * FROM p_opkssh_tokens").all(),
      ).toHaveLength(0),
    );
  });
});

describe("the browser sign-in", () => {
  it("runs opkssh with the plugin's config and the public callback", async () => {
    server = await startServer();
    await writeConfig();
    const socket = await startSignIn();
    const run = server.mock.processRuns[0];
    expect(run.file).toMatch(/opkssh-/);
    expect(run.args).toContain(
      `--config-path=${path.join(server.dataDir, "config.yml")}`,
    );
    expect(run.args).toContain(
      "--remote-redirect-uri=https://termix.test/plugin-api/opkssh/callback",
    );

    server.processes[0].emitStderr(
      "Opening browser to http://localhost:4567/chooser\n",
    );
    const status = socket.sent.find((m) => m.type === "opkssh_status");
    expect(status).toMatchObject({
      stage: "chooser",
      url: expect.stringMatching(
        /^https:\/\/termix\.test\/plugin-api\/opkssh\/chooser\/[\w-]+$/,
      ),
    });
  });

  it("keeps the old callback for an install upgraded from 2.8", async () => {
    server = await startServer({ settings: { legacyCallback: true } });
    await writeConfig();
    await startSignIn();
    expect(server.mock.processRuns[0].args).toContain(
      "--remote-redirect-uri=https://termix.test/host/opkssh-callback",
    );
  });

  it("writes a template and reports a missing config", async () => {
    server = await startServer();
    const socket = await startSignIn();
    expect(socket.sent[0]).toMatchObject({ type: "opkssh_config_error" });
    expect(
      await fs.readFile(path.join(server.dataDir, "config.yml"), "utf8"),
    ).toContain("OPKSSH Configuration");
    expect(server.mock.processRuns).toHaveLength(0);
  });

  it("refuses redirect_uris that are not localhost", async () => {
    server = await startServer();
    await writeConfig(
      `${PROVIDERS_CONFIG}    redirect_uris:\n      - https://termix.example/host/opkssh-callback\n`,
    );
    const socket = await startSignIn();
    expect(socket.sent[0]).toMatchObject({ type: "opkssh_config_error" });
    expect(String(socket.sent[0].error)).toMatch(/must only contain localhost/);
  });

  it("kills the process when the terminal goes away", async () => {
    server = await startServer();
    await writeConfig();
    const socket = await startSignIn();
    socket.close();
    await vi.waitFor(() =>
      expect(server!.processes[0].killed).toContain("SIGTERM"),
    );
  });
});

describe("routes", () => {
  it("reports and forgets a cached certificate", async () => {
    server = await startServer();
    expect((await server.request("GET", "/token/7")).body).toEqual({
      exists: false,
    });
    await writeConfig();
    await startSignIn();
    server.processes[0].emitStdout(`${KEY}\n${CERT}\n`);
    await vi.waitFor(async () =>
      expect((await server!.request("GET", "/token/7")).body.exists).toBe(true),
    );
    expect((await server.request("DELETE", "/token/7")).status).toBe(200);
    expect((await server.request("GET", "/token/7")).body.exists).toBe(false);
  });

  it("refuses a host the user cannot reach, and anonymous callers", async () => {
    server = await startServer();
    expect((await server.request("GET", "/token/99")).status).toBe(404);
    expect((await server.request("GET", "/token/7", { user: "" })).status).toBe(
      401,
    );
  });

  it("forwards the identity provider's callback to the sign-in it belongs to", async () => {
    server = await startServer();
    await writeConfig();
    const socket = await startSignIn();
    server.processes[0].emitStderr(
      "Opening browser to http://localhost:4567/chooser\n",
    );
    const requestId = String(
      socket.sent.find((m) => m.type === "opkssh_status")?.requestId,
    );
    const cookie = { cookie: `opkssh_request_id=${requestId}` };

    // OPKSSH's callback listener is not up yet.
    expect(
      (
        await server.request("GET", "/callback?code=x", {
          user: "",
          headers: cookie,
        })
      ).status,
    ).toBe(503);

    server.processes[0].emitStderr("listening on http://127.0.0.1:5555/\n");
    const forwarded = await server.request("GET", "/callback?code=x&state=s", {
      user: "",
      headers: cookie,
    });
    expect(forwarded.status).toBe(302);
    expect(forwarded.location).toBe(
      `/plugin-api/opkssh/callback/${requestId}?code=x&state=s`,
    );

    expect(
      (await server.request("GET", "/callback?code=x", { user: "" })).status,
    ).toBe(401);
  });

  it("answers an unknown sign-in with a not-found page", async () => {
    server = await startServer();
    const response = await server.request("GET", "/chooser/nope", { user: "" });
    expect(response.status).toBe(404);
    expect(String(response.body)).toContain("Session Not Found");
  });
});
