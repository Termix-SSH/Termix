import { afterEach, describe, expect, it } from "vitest";
import { host, startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const clientTunnel = (overrides: Record<string, unknown> = {}) => ({
  scope: "c2s",
  mode: "local",
  sourcePort: 8080,
  endpointPort: 5432,
  maxRetries: 3,
  retryInterval: 10,
  autoStart: false,
  ...overrides,
});

describe("client tunnel presets", () => {
  it("creates, lists by name, updates and deletes the caller's presets", async () => {
    server = await startServer();

    const zulu = await server.request("POST", "/presets", {
      body: {
        name: " Zulu ",
        config: [clientTunnel()],
        platform: "linux",
        computerName: "workstation",
      },
    });
    expect(zulu.status).toBe(201);
    expect(zulu.body).toMatchObject({
      name: "Zulu",
      config: [clientTunnel()],
      platform: "linux",
      computerName: "workstation",
    });
    await server.request("POST", "/presets", {
      body: { name: "Alpha", config: [] },
    });
    await server.request("POST", "/presets", {
      user: "user-2",
      body: { name: "Other", config: [] },
    });

    const listed = await server.request("GET", "/presets");
    expect(listed.body.map((p: { name: string }) => p.name)).toEqual([
      "Alpha",
      "Zulu",
    ]);

    const updated = await server.request("PUT", `/presets/${zulu.body.id}`, {
      body: { name: "Yankee", config: [clientTunnel({ mode: "dynamic" })] },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Yankee");
    expect(updated.body.config[0].mode).toBe("dynamic");

    const deleted = await server.request("DELETE", `/presets/${zulu.body.id}`);
    expect(deleted.body).toEqual({ success: true });
    expect(
      (await server.request("GET", "/presets")).body.map(
        (p: { name: string }) => p.name,
      ),
    ).toEqual(["Alpha"]);
    expect(server.db.persisted).toBeGreaterThan(0);
  });

  it("rejects a duplicate name and a config that is not a client tunnel", async () => {
    server = await startServer();
    await server.request("POST", "/presets", {
      body: { name: "Home", config: [] },
    });

    expect(
      (
        await server.request("POST", "/presets", {
          body: { name: "Home", config: [] },
        })
      ).status,
    ).toBe(409);

    for (const config of [
      [clientTunnel({ scope: "s2s" })],
      [clientTunnel({ mode: "sideways" })],
      [clientTunnel({ sourcePort: 70000 })],
      [clientTunnel({ endpointPort: 0 })],
      "nope",
    ]) {
      const res = await server.request("POST", "/presets", {
        body: { name: "Bad", config },
      });
      expect(res.status).toBe(400);
    }

    // Dynamic mode has no destination port to check.
    expect(
      (
        await server.request("POST", "/presets", {
          body: {
            name: "Socks",
            config: [clientTunnel({ mode: "dynamic", endpointPort: 0 })],
          },
        })
      ).status,
    ).toBe(201);
  });

  it("never lets one user touch another user's preset", async () => {
    server = await startServer();
    const mine = await server.request("POST", "/presets", {
      body: { name: "Mine", config: [] },
    });

    for (const [method, body] of [
      ["PUT", { name: "Stolen" }],
      ["DELETE", undefined],
    ] as const) {
      const res = await server.request(method, `/presets/${mine.body.id}`, {
        user: "user-2",
        body,
      });
      expect(res.status).toBe(404);
    }
    expect((await server.request("GET", "/presets")).body[0].name).toBe("Mine");
  });
});

describe("tunnel control", () => {
  it("refuses reserved names and a name that does not match its config", async () => {
    server = await startServer();

    const reserved = await server.request("POST", "/connect", {
      body: { name: "web:7:e1", sourceHostId: 7, tunnelIndex: 0 },
    });
    expect(reserved.status).toBe(400);
    expect(reserved.body.error).toMatch(/reserved/);

    const mismatched = await server.request("POST", "/connect", {
      body: {
        name: "7::0::web::8080::db::5432",
        sourceHostId: 7,
        tunnelIndex: 0,
        sourcePort: 9999,
        endpointHost: "db",
        endpointPort: 5432,
      },
    });
    expect(mismatched.status).toBe(400);
  });

  it("refuses to connect through a host the caller cannot reach", async () => {
    server = await startServer({ hosts: { "user-1": [host()] } });

    const res = await server.request("POST", "/connect", {
      user: "user-2",
      body: {
        name: "7::0::web::8080::db::5432",
        sourceHostId: 7,
        tunnelIndex: 0,
        sourcePort: 8080,
        endpointHost: "db",
        endpointPort: 5432,
      },
    });
    expect(res.status).toBe(403);
    expect(server.mock.sshConnections).toEqual([]);
  });

  it("denies stopping someone else's on-demand tunnel by guessing its name", async () => {
    server = await startServer({
      hosts: { "user-1": [host()], "user-2": [] },
    });

    for (const path of ["/disconnect", "/cancel"]) {
      const res = await server.request("POST", path, {
        user: "user-2",
        body: { tunnelName: "web:7:e1" },
      });
      expect(res.status).toBe(403);
    }

    const own = await server.request("POST", "/disconnect", {
      body: { tunnelName: "web:7:e1" },
    });
    expect(own.status).toBe(200);
  });

  it("answers an empty status map and a 404 for a tunnel nobody can see", async () => {
    server = await startServer();
    expect((await server.request("GET", "/status")).body).toEqual({});
    expect((await server.request("GET", "/status/nope")).status).toBe(404);
  });
});

describe("permissions", () => {
  it("answers 403 on every route without tunnels.use", async () => {
    server = await startServer({ permissions: [] });

    const routes: Array<[string, string, unknown?]> = [
      ["GET", "/status"],
      ["GET", "/status/stream"],
      ["GET", "/status/some-tunnel"],
      ["POST", "/connect", { name: "x", sourceHostId: 7, tunnelIndex: 0 }],
      ["POST", "/disconnect", { tunnelName: "x" }],
      ["POST", "/cancel", { tunnelName: "x" }],
      ["GET", "/presets"],
      ["POST", "/presets", { name: "x", config: [] }],
      ["PUT", "/presets/1", { name: "x" }],
      ["DELETE", "/presets/1"],
    ];
    for (const [method, path, body] of routes) {
      const res = await server.request(method, path, { body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});
