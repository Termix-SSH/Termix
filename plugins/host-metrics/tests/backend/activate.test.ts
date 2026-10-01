import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import {
  createMockCtx,
  createTestDb,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { activate } from "../../src/backend/index.js";
import type { MetricsViewersV1 } from "../../src/backend/index.js";
import { hostImportNormalizer } from "../../src/backend/host-import.js";
import { manifest, pluginDir, startServer, type TestServer } from "./server";

let db: TestDb | null = null;
let server: TestServer | null = null;

afterEach(async () => {
  db?.close();
  db = null;
  await server?.close();
  server = null;
});

describe("host-metrics activate", () => {
  it.each(["db:own", "network:serve"])(
    "fails closed without %s",
    async (missing) => {
      db = await createTestDb(pluginDir);
      const mock = createMockCtx({
        pluginId: manifest.id,
        manifest,
        capabilities: manifest.capabilities.filter((cap) => cap !== missing),
        db: db.database,
        router: () => express.Router(),
      });
      await expect(activate(mock.ctx)).rejects.toBeInstanceOf(
        PluginCapabilityError,
      );
    },
  );

  it("offers viewers as a service that runs as the caller", async () => {
    server = await startServer();
    const viewers = server.mock.services.get(
      "host-metrics.viewers",
    ) as MetricsViewersV1;

    const registered = await server.mock.ctx.asUser("user-1", () =>
      viewers.register(7),
    );
    expect(registered).toEqual({ viewerSessionId: expect.any(String) });
    const id = (registered as { viewerSessionId: string }).viewerSessionId;

    expect(
      await server.mock.ctx.asUser("user-1", async () => viewers.heartbeat(id)),
    ).toBe(true);
    expect(
      await server.mock.ctx.asUser("user-2", async () => viewers.heartbeat(id)),
    ).toBe(false);

    expect(
      await server.mock.ctx.asUser("user-1", () => viewers.register(99)),
    ).toEqual({ skipped: true, reason: "host_not_found" });
  });

  it("stops every timer when the plugin is disabled", async () => {
    server = await startServer();
    const jobs = server.mock.scheduled;
    expect(jobs.length).toBeGreaterThan(0);
    for (const dispose of server.mock.disposals) await dispose();
    expect(jobs.every((job) => job.stopped)).toBe(true);
  });

  it("registers its host import normalizer", async () => {
    server = await startServer();
    expect(
      server.mock.ctx.registry.consume("host-metrics.hostImportNormalizer"),
    ).toBe(hostImportNormalizer);
  });
});

describe("hostImportNormalizer", () => {
  it("reads this plugin's settings from a Termix export", () => {
    expect(
      hostImportNormalizer({
        pluginSettings: {
          "host-metrics": { metricsEnabled: false, enabledWidgets: ["cpu"] },
        },
      }),
    ).toMatchObject({ metricsEnabled: false, enabledWidgets: ["cpu"] });
  });

  it("reads the metrics half of an export from before 2.9.0", () => {
    expect(
      hostImportNormalizer({
        statsConfig: {
          statusCheckEnabled: false,
          metricsEnabled: true,
          metricsInterval: 45,
          useGlobalMetricsInterval: false,
          excludedMounts: ["/snap"],
        },
      }),
    ).toMatchObject({
      metricsEnabled: true,
      metricsInterval: 45,
      excludedMounts: ["/snap"],
    });
  });

  it("ignores the old interval while the global one was in use", () => {
    expect(
      hostImportNormalizer({ statsConfig: { metricsInterval: 45 } }),
    ).toMatchObject({ metricsInterval: null });
  });

  it("writes nothing for a row without metrics settings", () => {
    expect(hostImportNormalizer({ name: "x" })).toBeNull();
  });
});
