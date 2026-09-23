import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import {
  createMockCtx,
  createTestDb,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
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

describe("workspaces activate", () => {
  it("registers a sync entity that leaves the per-install last session out", async () => {
    server = await startServer();
    const [entity] = server.mock.syncEntities;
    expect(entity.type).toBe("workspaces");
    expect(entity.shouldSync?.({ kind: "manual" })).toBe(true);
    expect(entity.shouldSync?.({ kind: "last_session" })).toBe(false);
  });

  it("offers the user's manual workspaces as a service", async () => {
    server = await startServer();
    await server.request("POST", "/", {
      body: { name: "Prod", payload: { version: 1, tabs: [] } },
    });
    await server.request("PUT", "/last-session", {
      body: { payload: { version: 1, tabs: [] } },
    });

    const service = server.mock.services.get("workspaces.saved") as {
      list: () => Promise<unknown>;
    };
    const listed = await server.mock.ctx.asUser("user-1", () => service.list());
    expect(listed).toEqual([
      { id: expect.any(Number), name: "Prod", isDefault: false },
    ]);
  });

  it("fails closed without db:own", async () => {
    db = await createTestDb(pluginDir);
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: ["network:serve", "ui:surface"],
      db: db.database,
      router: () => express.Router(),
    });
    await expect(activate(mock.ctx)).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
  });

  it("fails closed without network:serve", async () => {
    db = await createTestDb(pluginDir);
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: ["db:own", "ui:surface"],
      db: db.database,
      router: () => express.Router(),
    });
    await expect(activate(mock.ctx)).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
  });
});
