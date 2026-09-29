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

describe("snippets activate", () => {
  it("registers snippets and snippetFolders sync entities at the legacy order values", async () => {
    server = await startServer();
    const types = server.mock.syncEntities.map((e) => e.type);
    expect(types).toContain("snippets");
    expect(types).toContain("snippetFolders");

    const snippetsEntity = server.mock.syncEntities.find(
      (e) => e.type === "snippets",
    );
    const foldersEntity = server.mock.syncEntities.find(
      (e) => e.type === "snippetFolders",
    );
    expect(snippetsEntity?.order).toBe(60);
    expect(foldersEntity?.order).toBe(40);
  });

  it("offers the snippets.access service, scoped to the calling user", async () => {
    server = await startServer();
    await server.request("POST", "/", {
      body: { name: "Deploy", content: "echo deploy" },
    });

    const service = server.mock.services.get("snippets.access") as {
      list: () => Promise<unknown>;
    };
    const listed = await server.mock.actAs("user-1", () => service.list());
    expect(listed).toEqual([
      expect.objectContaining({ name: "Deploy", content: "echo deploy" }),
    ]);

    const otherUsersList = await server.mock.actAs("user-2", () =>
      service.list(),
    );
    expect(otherUsersList).toEqual([]);
  });

  it("refuses service writes the user could not make in the panel", async () => {
    server = await startServer({ permissions: ["snippets.view"] });
    const service = server.mock.services.get("snippets.access") as {
      create: (input: { name: string; content: string }) => Promise<unknown>;
      update: (id: number, changes: { name: string }) => Promise<unknown>;
      remove: (id: number) => Promise<unknown>;
    };
    const asUser = <T>(fn: () => Promise<T>) =>
      server!.mock.actAs("user-1", fn);

    await expect(
      asUser(() => service.create({ name: "x", content: "ls" })),
    ).rejects.toThrow("snippets.create");
    await expect(
      asUser(() => service.update(1, { name: "y" })),
    ).rejects.toThrow("snippets.edit");
    await expect(asUser(() => service.remove(1))).rejects.toThrow(
      "snippets.delete",
    );
  });

  it("wipes a user's snippets when user.data_wiped fires", async () => {
    // events:core only to simulate core firing the topic in this test; the
    // plugin's own manifest never declares it, since it only subscribes.
    server = await startServer({
      capabilities: [...manifest.capabilities, "events:core"],
    });
    await server.request("POST", "/", {
      body: { name: "Deploy", content: "echo deploy" },
    });

    const before = (await server.request("GET", "/")).body;
    expect(before).toHaveLength(1);

    server.mock.ctx.events.emit("user.data_wiped", { userId: "user-1" });
    // The listener's delete is fire-and-forget; give its microtasks a turn.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const after = (await server.request("GET", "/")).body;
    expect(after).toHaveLength(0);
  });

  it("registers its host settings hooks and the variables helper", async () => {
    server = await startServer();
    const registry = server.mock.ctx.registry;
    for (const key of [
      "snippets.hostImportNormalizer",
      "snippets.hostPayloadLegacy",
      "snippets.hostSettingsSync",
    ]) {
      expect(registry.consume(key), key).toBeDefined();
    }
    const variables = registry.consume<{
      resolve: (c: string, h: { ip?: string } | null) => string;
      extractInputs: (c: string) => Array<{ key: string }>;
    }>("snippets.variables");
    expect(variables?.resolve("ping $HOST", { ip: "10.0.0.1" })).toBe(
      "ping 10.0.0.1",
    );
    expect(variables?.extractInputs("echo $INPUT_1")).toEqual([
      { key: "INPUT_1", label: "Input 1" },
    ]);
  });

  it("fails closed without db:own", async () => {
    db = await createTestDb(pluginDir);
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: [
        "network:serve",
        "ssh:connect",
        "credentials:use",
        "ui:surface",
      ],
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
      capabilities: ["db:own", "ssh:connect", "credentials:use", "ui:surface"],
      db: db.database,
      router: () => express.Router(),
    });
    await expect(activate(mock.ctx)).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
  });
});
