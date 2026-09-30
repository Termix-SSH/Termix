import { afterEach, describe, expect, it } from "vitest";
import { createAiRepository } from "../../src/backend/repository.js";
import { startServer, type TestServer } from "./helpers";

const servers: TestServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});
async function setup() {
  const server = await startServer();
  servers.push(server);
  const repo = await createAiRepository(server.mock.ctx);
  const entity = server.mock.syncEntities.find(
    (entry) => entry.type === "aiProviders",
  )!;
  expect(entity).toBeDefined();
  return { ...server, repo, entity };
}
const noReference = async () => null;

describe("AI provider sync", () => {
  it("maps the key to the destination id, rotates and clears it without storing plaintext in the row", async () => {
    const source = await setup();
    const target = await setup();
    const sourceRow = await source.mock.ctx.asUser("user-1", () =>
      source.repo.createProvider("user-1", {
        providerType: "openai",
        label: "Work",
        apiKey: "test-key-first",
        enabled: false,
      }),
    );
    // The other device already has a different provider at the source's id.
    await target.mock.ctx.asUser("user-1", () =>
      target.repo.createProvider("user-1", {
        providerType: "openai",
        label: "Local",
        apiKey: "test-local-key",
      }),
    );
    const targetRow = await target.mock.ctx.asUser("user-1", () =>
      target.repo.createProvider("user-1", {
        providerType: "openai",
        label: "Work",
      }),
    );
    expect(sourceRow.id).not.toBe(targetRow.id);
    for (const apiKey of ["test-key-first", "test-key-rotated", null]) {
      await source.mock.ctx.asUser("user-1", () =>
        source.repo.updateProvider(sourceRow.id, "user-1", { apiKey }),
      );
      source.mock.setActor("user-2");
      const row = await source.repo.findProvider(sourceRow.id, "user-1");
      const wire = await source.entity.serialize!({ ...row! }, noReference);
      expect(wire.apiKey).toBe(apiKey);
      const fields = await target.entity.deserialize!(wire, noReference);
      expect(fields).not.toHaveProperty("apiKey");
      expect(fields.enabled).toBe(false);
      await target.entity.afterWrite!({
        id: targetRow.id,
        userId: "user-1",
        wire,
        created: false,
      });
      expect(
        target.mock.secretStore.get(`user-1:provider:${targetRow.id}`) ?? null,
      ).toBe(apiKey);
      expect(
        target.mock.secretStore.get(`user-1:provider:${sourceRow.id}`),
      ).toBe("test-local-key");
      expect(
        target.mock.secretStore.get(`user-2:provider:${targetRow.id}`),
      ).toBeUndefined();
    }
    expect(
      target.db.sqlite.prepare("PRAGMA table_info(p_ai_providers)").all(),
    ).not.toContainEqual(expect.objectContaining({ name: "api_key" }));
    expect(
      target.db.sqlite.prepare("PRAGMA table_info(p_ai_providers)").all(),
    ).toContainEqual(expect.objectContaining({ name: "sync_id" }));
  });

  it("cleans up the destination secret on deletion and declares provider management permissions", async () => {
    const server = await setup();
    const row = await server.mock.ctx.asUser("user-1", () =>
      server.repo.createProvider("user-1", {
        providerType: "openai",
        label: "Work",
        apiKey: "test-delete-key",
      }),
    );
    expect(server.entity.permissions).toEqual({
      create: "ai.manage_providers",
      update: "ai.manage_providers",
      delete: "ai.manage_providers",
    });
    await server.entity.remove!({ ...row }, "user-2");
    expect(await server.repo.findProvider(row.id, "user-1")).not.toBeNull();
    await server.entity.remove!({ ...row }, "user-1");
    expect(await server.repo.findProvider(row.id, "user-1")).toBeNull();
    expect(
      server.mock.secretStore.get(`user-1:provider:${row.id}`),
    ).toBeUndefined();
  });

  it("rejects invalid secret payloads before the row is written", async () => {
    const server = await setup();
    await expect(
      server.entity.deserialize!({ apiKey: {} }, noReference),
    ).rejects.toThrow("Invalid synced provider key");
  });
});
