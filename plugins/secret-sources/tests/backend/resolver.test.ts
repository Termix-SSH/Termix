import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createMockCtx, createTestDb } from "@termix/plugin-sdk/testing";
import { createSecretSourceRepository } from "../../src/backend/repository.js";
import { createTokenStore } from "../../src/backend/token-store.js";
import { registerOnePasswordResolver } from "../../src/backend/resolver.js";
import { sources } from "../../src/backend/tables.js";
import manifestJson from "../../manifest.json";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

const manifest = manifestJson as unknown as PluginManifest;
const pluginDir = fileURLToPath(new URL("../..", import.meta.url));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

async function setUp(fetchMock: ReturnType<typeof vi.fn>) {
  const db = await createTestDb(pluginDir);
  db.sqlite
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run("owner-1", "owner-1");

  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    actor: "owner-1",
    fetch: fetchMock as never,
  });

  const table = await mock.ctx.db.define(sources);
  const repository = createSecretSourceRepository(mock.ctx.db, table as never);
  const tokenStore = createTokenStore(mock.ctx);
  registerOnePasswordResolver(mock.ctx, repository, tokenStore);

  const resolve = mock.auth.secretResolvers.get("op");
  if (!resolve) throw new Error("resolver was not registered");

  return { db, repository, tokenStore, resolve };
}

describe("op:// secret resolver", () => {
  it("registers under the declared scheme", async () => {
    const { resolve } = await setUp(vi.fn());
    expect(typeof resolve).toBe("function");
  });

  it("resolves through the owner's source", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "vid", name: "Infra" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "iid", title: "prod-db" }]))
      .mockResolvedValueOnce(
        jsonResponse({
          fields: [{ id: "f1", label: "password", value: "s3cret" }],
        }),
      );
    const { repository, tokenStore, resolve } = await setUp(fetchMock);

    const source = await repository.create({
      id: "src-1",
      userId: "owner-1",
      name: "n",
      kind: "onepassword-connect",
      baseUrl: "https://connect.internal",
      shared: false,
    });
    await tokenStore.set(source.id, "tok");

    const value = await resolve("owner-1", "op://Infra/prod-db/password");
    expect(value).toBe("s3cret");
  });

  it("fails clearly with no configured source", async () => {
    const { resolve } = await setUp(vi.fn());
    await expect(
      resolve("nobody", "op://Infra/prod-db/password"),
    ).rejects.toThrow(/no secret source is configured/);
  });

  it("rejects a malformed reference", async () => {
    const { resolve } = await setUp(vi.fn());
    await expect(resolve("owner-1", "op://only-two")).rejects.toThrow(
      /Invalid secret reference/,
    );
  });
});
