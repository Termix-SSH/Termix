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

describe("network-topology activate", () => {
  it("registers a singleton sync entity with the JSON blob serializer", async () => {
    server = await startServer();
    const [entity] = server.mock.syncEntities;
    expect(entity.type).toBe("networkTopology");
    expect(entity.singleton).toBe(true);
    expect(entity.serialize).toBeTypeOf("function");
    expect(entity.deserialize).toBeTypeOf("function");
  });

  it("offers the user's saved graph as a service", async () => {
    server = await startServer();
    await server.request("POST", "/", {
      body: { topology: { nodes: [{ data: { id: "1" } }], edges: [] } },
    });

    const service = server.mock.services.get("network-topology.graph") as {
      get: () => Promise<unknown>;
    };
    const result = await server.mock.ctx.asUser("user-1", () => service.get());
    expect(result).toEqual({ nodes: [{ data: { id: "1" } }], edges: [] });
  });

  it("returns null from the service when the user has no saved graph", async () => {
    server = await startServer();
    const service = server.mock.services.get("network-topology.graph") as {
      get: () => Promise<unknown>;
    };
    const result = await server.mock.ctx.asUser("user-1", () => service.get());
    expect(result).toBeNull();
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
