import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import {
  createMockCtx,
  createTestDb,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import { activate } from "../../src/backend/index.js";
import {
  NOTIFICATION_CHANNELS_DDL,
  definition,
  manifest,
  pluginDir,
  startServer,
  type TestServer,
} from "./helpers";

let db: TestDb | null = null;
let server: TestServer | null = null;

afterEach(async () => {
  db?.close();
  db = null;
  await server?.close();
  server = null;
});

describe("automations activate", () => {
  it("provides automations.access and mounts the webhook as public", async () => {
    server = await startServer();
    expect(server.mock.services.get("automations.access")).toBeDefined();
    expect(server.mock.httpRouters).toEqual([{ public: ["/webhook/:token"] }]);
  });

  it.each(["db:own", "network:serve"])(
    "fails closed without %s",
    async (capability) => {
      db = await createTestDb(pluginDir, {
        before: (sqlite) => sqlite.exec(NOTIFICATION_CHANNELS_DDL),
      });
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

  it("cannot notify without notify:send", async () => {
    server = await startServer();
    const withoutNotify = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: manifest.capabilities.filter((c) => c !== "notify:send"),
    });
    await expect(
      withoutNotify.ctx.notify.send([1], { title: "t", body: "b" }),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
  });

  it("stops every timer on deactivate", async () => {
    server = await startServer();
    await server.request("POST", "/", {
      body: {
        name: "Tick",
        definition: definition({ kind: "schedule", intervalSeconds: 300 }),
      },
    });
    for (const dispose of [...server.mock.disposals].reverse()) {
      await Promise.resolve(dispose()).catch(() => {});
    }
    server.mock.disposals.length = 0;
    expect(server.mock.scheduled.every((job) => job.stopped)).toBe(true);
  });
});
