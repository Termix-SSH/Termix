import { afterEach, describe, expect, it } from "vitest";
import type {
  PluginSshConnectOptions,
  PluginSshHost,
} from "@termix/plugin-sdk/backend";
import { startServer, type TestServer } from "./server";
import { FakeClient } from "./fake-ssh";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function connect(s: TestServer, sessionId = "s1", hostId = 7) {
  return s.request("POST", "/ssh/connect", { body: { sessionId, hostId } });
}

/** Swaps ctx.ssh.connect for one that runs `flow` against the prompt channel. */
function promptingConnect(
  s: TestServer,
  flow: (
    ask: NonNullable<PluginSshConnectOptions["prompt"]>["ask"],
  ) => Promise<void>,
) {
  s.mock.ctx.ssh.connect = (async (
    host: PluginSshHost,
    options?: PluginSshConnectOptions,
  ) => {
    await flow(options!.prompt!.ask);
    return {
      client: s.client as never,
      jumpClient: null,
      host,
      dispose: () => s.client.end(),
    };
  }) as never;
}

describe("docker routes", () => {
  it("refuses every route without docker.use", async () => {
    server = await startServer({ permissions: [] });
    const calls: Array<[string, string]> = [
      ["POST", "/ssh/connect"],
      ["POST", "/ssh/connect-totp"],
      ["POST", "/ssh/connect-browser-sign-in"],
      ["POST", "/ssh/disconnect"],
      ["POST", "/ssh/keepalive"],
      ["GET", "/ssh/status?sessionId=s1"],
      ["GET", "/validate/s1"],
      ["GET", "/containers/s1"],
      ["GET", "/containers/s1/abc"],
      ["POST", "/containers/s1/abc/start"],
      ["DELETE", "/containers/s1/abc/remove"],
      ["GET", "/containers/s1/abc/logs"],
      ["GET", "/containers/s1/abc/stats"],
    ];
    for (const [method, path] of calls) {
      const response = await server.request(method, path, {
        body: method === "GET" ? undefined : {},
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("refuses a host with Docker switched off", async () => {
    server = await startServer({ dockerOn: false });
    const response = await connect(server);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("DOCKER_DISABLED");
  });

  it("answers 404 for a host the user cannot reach", async () => {
    server = await startServer();
    expect((await connect(server, "s1", 99)).status).toBe(404);
  });

  it("connects, validates and manages containers on the session", async () => {
    server = await startServer();
    const connected = await connect(server);
    expect(connected.status).toBe(200);
    expect(connected.body.success).toBe(true);
    expect(server.mock.statusReports).toContainEqual({ hostId: 7, ok: true });

    const validation = await server.request("GET", "/validate/s1");
    expect(validation.body).toEqual({
      available: true,
      version: "27.1.1",
      runtime: "docker",
    });

    const list = await server.request("GET", "/containers/s1");
    expect(list.body).toEqual([
      expect.objectContaining({ id: "abc123", name: "web", state: "running" }),
    ]);

    server.client.reply(/ start abc123$/, { stdout: "abc123" });
    const started = await server.request("POST", "/containers/s1/abc123/start");
    expect(started.status).toBe(200);
    expect(
      server.client.commands.some((c) => c.endsWith("docker start abc123")),
    ).toBe(true);

    server.client.reply(/ logs abc123/, { stdout: "line one\nline two\n" });
    const logs = await server.request(
      "GET",
      "/containers/s1/abc123/logs?tail=50&since=2026-01-01T00:00:00Z",
    );
    expect(logs.body).toEqual({ success: true, logs: "line one\nline two\n" });
    expect(server.client.commands.at(-1)).toContain(
      "logs abc123 --tail 50 --since 2026-01-01T00:00:00Z 2>&1",
    );

    server.client.reply(/ stats abc123/, {
      stdout:
        '{"cpu":"1.5%","memory":"10MiB / 1GiB","memoryPercent":"1%","netIO":"1kB / 2kB","blockIO":"0B / 0B","pids":"3"}',
    });
    const stats = await server.request("GET", "/containers/s1/abc123/stats");
    expect(stats.body).toMatchObject({
      cpu: "1.5%",
      memoryUsed: "10MiB",
      memoryLimit: "1GiB",
      netInput: "1kB",
      netOutput: "2kB",
    });

    server.client.reply(/ rm abc123/, {
      code: 1,
      stderr: "Error: No such container: abc123",
    });
    const removed = await server.request(
      "DELETE",
      "/containers/s1/abc123/remove",
    );
    expect(removed.status).toBe(404);

    expect(
      (await server.request("POST", "/containers/s1/abc123/explode")).status,
    ).toBe(404);
    expect(
      (await server.request("GET", "/containers/s1/bad;id/logs")).status,
    ).toBe(400);

    await server.request("POST", "/ssh/disconnect", {
      body: { sessionId: "s1" },
    });
    const status = await server.request("GET", "/ssh/status?sessionId=s1");
    expect(status.body.connected).toBe(false);
  });

  it("uses Podman when the host says so", async () => {
    server = await startServer();
    await server.mock.ctx.settings.setHost(7, "containerRuntime", "podman");
    await connect(server);
    await server.request("GET", "/containers/s1");
    expect(server.client.commands.at(-1)).toMatch(/ podman ps -a --format/);
  });

  it("keeps another user's session to its owner", async () => {
    server = await startServer();
    await connect(server);
    const response = await server.request("GET", "/containers/s1", {
      user: "user-2",
    });
    expect(response.status).toBe(400);
    const status = await server.request("GET", "/ssh/status?sessionId=s1", {
      user: "user-2",
    });
    expect(status.body.connected).toBe(false);
  });

  it("parks a TOTP prompt and re-asks after a wrong code", async () => {
    server = await startServer();
    promptingConnect(server, async (ask) => {
      let code = await ask({ kind: "totp", prompt: "Code:", retry: false });
      while (code !== "123456") {
        if (code === null) throw new Error("Cancelled");
        code = await ask({ kind: "totp", prompt: "Code:", retry: true });
      }
    });

    const first = await connect(server);
    expect(first.body).toMatchObject({ requires_totp: true, prompt: "Code:" });

    const pending = await server.request("GET", "/containers/s1");
    expect(pending.body.code).toBe("AUTH_PENDING");

    const wrong = await server.request("POST", "/ssh/connect-totp", {
      body: { sessionId: "s1", totpCode: "000000" },
    });
    expect(wrong.body).toMatchObject({ requires_totp: true, retry: true });

    const stranger = await server.request("POST", "/ssh/connect-totp", {
      user: "user-2",
      body: { sessionId: "s1", totpCode: "123456" },
    });
    expect(stranger.status).toBe(404);

    const right = await server.request("POST", "/ssh/connect-totp", {
      body: { sessionId: "s1", totpCode: "123456" },
    });
    expect(right.body).toMatchObject({ success: true, status: "success" });
    expect((await server.request("GET", "/containers/s1")).status).toBe(200);
  });

  it("continues a browser sign-in and refuses a code for it", async () => {
    server = await startServer();
    promptingConnect(server, async (ask) => {
      await ask({
        kind: "browser",
        id: "gateway",
        label: "Gateway",
        url: "https://gateway.example/login",
        code: "KEY",
        instructions: "",
      });
    });

    const first = await connect(server);
    expect(first.body).toMatchObject({
      requires_browser_sign_in: true,
      label: "Gateway",
      url: "https://gateway.example/login",
      code: "KEY",
    });
    const wrongKind = await server.request("POST", "/ssh/connect-totp", {
      body: { sessionId: "s1", totpCode: "1" },
    });
    expect(wrongKind.status).toBe(400);

    const done = await server.request("POST", "/ssh/connect-browser-sign-in", {
      body: { sessionId: "s1" },
    });
    expect(done.body.success).toBe(true);
  });

  it("asks for credentials when a host with no secret gets a password prompt", async () => {
    server = await startServer({
      mock: {
        sshHosts: [
          {
            id: 7,
            userId: "user-1",
            ip: "10.0.0.7",
            port: 22,
            username: "root",
            authType: "none",
          },
        ],
      },
    });
    promptingConnect(server, async (ask) => {
      const answer = await ask({
        kind: "input",
        prompt: "Password:",
        echo: false,
        isPush: false,
      });
      if (answer === null)
        throw new Error("All configured authentication methods failed");
    });

    const response = await connect(server);
    expect(response.body).toEqual({
      status: "auth_required",
      reason: "no_keyboard",
    });
  });

  it("reports a failed login to core", async () => {
    const client = new FakeClient();
    server = await startServer({ client });
    server.mock.ctx.ssh.connect = (async () => {
      throw new Error("All configured authentication methods failed");
    }) as never;
    const response = await connect(server);
    expect(response.status).toBe(500);
    expect(server.mock.statusReports).toContainEqual({
      hostId: 7,
      ok: false,
      hostKeyChanged: false,
    });
  });
});
