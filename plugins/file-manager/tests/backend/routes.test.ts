import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers.js";

let server: TestServer;

beforeEach(async () => {
  server = await startServer();
});

afterEach(async () => {
  await server.close();
});

describe("recent/pinned/shortcuts", () => {
  it("round-trips a recent file", async () => {
    server.db.sqlite.exec("INSERT INTO ssh_data (id) VALUES (1)");

    const add = await server.request("POST", "/recent", {
      body: { hostId: 1, path: "/etc/hosts", name: "hosts" },
    });
    expect(add.status).toBe(200);

    const list = await server.request("GET", "/recent?hostId=1");
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      expect.objectContaining({ name: "hosts", path: "/etc/hosts" }),
    ]);
  });

  it("refuses to pin the same path twice", async () => {
    server.db.sqlite.exec("INSERT INTO ssh_data (id) VALUES (1)");

    const first = await server.request("POST", "/pinned", {
      body: { hostId: 1, path: "/var/log", name: "logs" },
    });
    expect(first.status).toBe(200);

    const second = await server.request("POST", "/pinned", {
      body: { hostId: 1, path: "/var/log", name: "logs" },
    });
    expect(second.status).toBe(409);
  });
});

describe("file-manager.use", () => {
  it("refuses every route without it", async () => {
    await server.close();
    server = await startServer({ permissions: [] });

    for (const [method, path] of [
      ["GET", "/status?sessionId=x"],
      ["POST", "/connect"],
      ["GET", "/recent?hostId=1"],
      ["POST", "/recent"],
      ["GET", "/pinned?hostId=1"],
      ["POST", "/pinned"],
      ["GET", "/shortcuts?hostId=1"],
      ["POST", "/shortcuts"],
      ["GET", "/activeTransfers"],
    ] as const) {
      const res = await server.request(method, path, {
        body: { hostId: 1, path: "/tmp", name: "tmp" },
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.required).toBe("file-manager.use");
    }
  });
});
