import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import {
  createMockCtx,
  createTestDb,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import { activate } from "../../src/backend/index.js";
import { manifest, pluginDir, startServer, type TestServer } from "./helpers";

let db: TestDb | null = null;
let server: TestServer | null = null;

afterEach(async () => {
  db?.close();
  db = null;
  await server?.close();
  server = null;
});

describe("session-sharing activate", () => {
  it("provides sessions.sharing and the guest resolver", async () => {
    server = await startServer();
    expect(server.mock.services.get("sessions.sharing")).toBeDefined();
    expect(typeof server.guests.resolve).toBe("function");
    expect(server.mock.httpRouters).toEqual([
      { public: ["/resolve/:linkToken", "/guest/:token"] },
    ]);
  });

  it.each(["db:own", "network:serve"])(
    "fails closed without %s",
    async (capability) => {
      db = await createTestDb(pluginDir);
      const mock = createMockCtx({
        pluginId: manifest.id,
        manifest,
        capabilities: manifest.capabilities.filter((c) => c !== capability),
        db: db.database,
        router: () => express.Router(),
      });
      await expect(activate(mock.ctx)).rejects.toBeInstanceOf(
        PluginCapabilityError,
      );
      for (const dispose of [...mock.disposals].reverse()) await dispose();
    },
  );

  it("cannot check a share target's host access without hosts:read", async () => {
    db = await createTestDb(pluginDir);
    db.sqlite.exec(
      "INSERT INTO users (id, username) VALUES ('alice', 'alice'), ('bob', 'bob'); INSERT INTO ssh_data (id) VALUES (1)",
    );
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: manifest.capabilities.filter((c) => c !== "hosts:read"),
      db: db.database,
      router: () => express.Router(),
      actor: "bob",
    });
    await activate(mock.ctx);
    await expect(
      mock.ctx.asUser("bob", () => mock.ctx.hosts.checkAccess(1, "connect")),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
    for (const dispose of [...mock.disposals].reverse()) await dispose();
  });
});
