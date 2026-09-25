import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { activate } from "../../src/backend/index.js";
import {
  host,
  manifest,
  pluginDir,
  startServer,
  withHosts,
  type TestServer,
} from "./helpers";

let db: TestDb | null = null;
let server: TestServer | null = null;
let mock: MockPluginContext | null = null;

afterEach(async () => {
  for (const dispose of [...(mock?.disposals ?? [])].reverse()) await dispose();
  mock = null;
  db?.close();
  db = null;
  await server?.close();
  server = null;
});

async function activateWithout(capability: string, actor?: string) {
  db = await createTestDb(pluginDir);
  mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities.filter((c) => c !== capability),
    db: db.database,
    router: () => express.Router(),
    actor,
  });
  return mock;
}

describe("tunnels activate", () => {
  it("provides tunnels.access and serves the client relay socket", async () => {
    server = await startServer();
    const service = server.mock.services.get("tunnels.access") as Record<
      string,
      unknown
    >;
    for (const method of ["forward", "start", "stop", "status", "list"]) {
      expect(typeof service[method]).toBe("function");
    }
    expect(server.mock.wsRoutes).toMatchObject([
      { path: "/c2s/stream", raw: false },
    ]);
  });

  for (const capability of ["db:own", "network:serve"]) {
    it(`fails closed without ${capability}`, async () => {
      const ctx = await activateWithout(capability);
      await expect(activate(ctx.ctx)).rejects.toBeInstanceOf(
        PluginCapabilityError,
      );
    });
  }

  for (const capability of ["ssh:connect", "credentials:use", "hosts:read"]) {
    it(`cannot open a tunnel without ${capability}`, async () => {
      const ctx = await activateWithout(capability, "user-1");
      // Host lookups stay gated when hosts:read is the one missing.
      if (capability !== "hosts:read") withHosts(ctx, { "user-1": [host()] });
      await activate(ctx.ctx);
      const service = ctx.services.get("tunnels.access") as {
        forward: (id: number, target: unknown) => Promise<unknown>;
      };

      await expect(
        service.forward(7, { targetHost: "127.0.0.1", targetPort: 80 }),
      ).rejects.toBeInstanceOf(PluginCapabilityError);
    });
  }
});
