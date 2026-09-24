import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const history = (s: TestServer) =>
  s.db.sqlite
    .prepare(
      "SELECT user_id, host_id, command FROM p_ssh_terminal_command_history ORDER BY id",
    )
    .all();

describe("command history routes", () => {
  it("saves, lists newest first without duplicates, deletes and clears", async () => {
    server = await startServer();
    for (const command of ["ls", "pwd", "ls"]) {
      const saved = await server.request("POST", "/command-history", {
        body: { hostId: 1, command },
      });
      expect(saved.status).toBe(201);
    }
    await server.request("POST", "/command-history", {
      user: "user-2",
      body: { hostId: 1, command: "whoami" },
    });

    const listed = await server.request("GET", "/command-history/1");
    expect(listed.body).toEqual(["ls", "pwd"]);

    await server.request("POST", "/command-history/delete", {
      body: { hostId: 1, command: "pwd" },
    });
    expect((await server.request("GET", "/command-history/1")).body).toEqual([
      "ls",
    ]);

    await server.request("DELETE", "/command-history/1");
    expect(history(server)).toEqual([
      { user_id: "user-2", host_id: 1, command: "whoami" },
    ]);
    expect(server.db.persisted).toBeGreaterThan(0);
  });

  it("acknowledges but never stores a command that looks like a secret", async () => {
    server = await startServer();
    const saved = await server.request("POST", "/command-history", {
      body: { hostId: 1, command: "export API_TOKEN=abc" },
    });
    expect(saved.status).toBe(201);
    expect(history(server)).toEqual([]);
  });

  it("stores nothing while command history is off globally", async () => {
    server = await startServer({ settings: { commandHistoryEnabled: false } });
    await server.request("POST", "/command-history", {
      body: { hostId: 1, command: "ls" },
    });
    expect(history(server)).toEqual([]);
  });

  it("stores nothing for a host that turned command history off", async () => {
    server = await startServer();
    await server.mock.ctx.settings.setHost(2, "enableCommandHistory", false);
    await server.request("POST", "/command-history", {
      body: { hostId: 2, command: "ls" },
    });
    await server.request("POST", "/command-history", {
      body: { hostId: 1, command: "ls" },
    });
    expect(history(server)).toEqual([
      { user_id: "user-1", host_id: 1, command: "ls" },
    ]);
  });

  it("rejects a request missing its fields", async () => {
    server = await startServer();
    const saved = await server.request("POST", "/command-history", {
      body: { hostId: 1 },
    });
    expect(saved.status).toBe(400);
  });

  it("needs hosts.view for the recent list", async () => {
    server = await startServer({ permissions: [] });
    const denied = await server.request("GET", "/command-history/1/recent");
    expect(denied.status).toBe(403);
  });

  it("lists recent commands with duplicates for a hosts.view holder", async () => {
    server = await startServer({ permissions: ["hosts.view"] });
    for (const command of ["uptime", "uptime"]) {
      await server.request("POST", "/command-history", {
        body: { hostId: 1, command },
      });
    }
    const allowed = await server.request("GET", "/command-history/1/recent");
    expect(allowed.body).toEqual(["uptime", "uptime"]);
  });
});

describe("client settings and image storage", () => {
  it("serves the terminal's settings to any signed-in user", async () => {
    server = await startServer({
      settings: { sessionTimeoutMinutes: 45, sessionPersistence: false },
    });
    const { body } = await server.request("GET", "/client-settings");
    expect(body.sessionTimeoutMinutes).toBe(45);
    expect(body.sessionPersistence).toBe(false);
    expect(body.commandHistoryEnabled).toBe(true);
    expect(body.touchInput.enabled).toBe(true);
  });

  it("refuses the image storage test to a non-admin", async () => {
    server = await startServer({ permissions: [] });
    const denied = await server.request("POST", "/image-storage/test", {
      body: { instanceId: "tab-1" },
    });
    expect(denied.status).toBe(403);
  });

  it("reports an unconnected session to an admin", async () => {
    server = await startServer({ permissions: ["admin.plugins.manage"] });
    const result = await server.request("POST", "/image-storage/test", {
      body: { instanceId: "tab-1" },
    });
    expect(result.status).toBe(200);
    expect(result.body.connected).toBe(false);
  });
});
