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

describe("ai activate", () => {
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
    },
  );

  it("cannot store a provider key without secrets:own", async () => {
    db = await createTestDb(pluginDir);
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: manifest.capabilities.filter((c) => c !== "secrets:own"),
      db: db.database,
      router: () => express.Router(),
    });
    await activate(mock.ctx);
    await expect(
      mock.ctx.secrets.set("provider:1", "k"),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
  });

  it("offers the api key and the host import normalizer", async () => {
    server = await startServer();
    await server.enableFor("user-1");
    await server.request("POST", "/providers", {
      body: { providerType: "openai", label: "Work", apiKey: "sk-shared" },
    });

    const normalizer = server.mock.ctx.registry.consume<
      (raw: Record<string, unknown>) => Record<string, unknown> | null
    >("ai.hostImportNormalizer");
    expect(normalizer?.({ enableAiAssistant: true })).toEqual({
      enableAiAssistant: true,
    });
    expect(
      normalizer?.({ pluginSettings: { ai: { enableAiAssistant: false } } }),
    ).toEqual({ enableAiAssistant: false });
    expect(normalizer?.({ name: "x" })).toBeNull();
  });
});
