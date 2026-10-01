import { describe, expect, it } from "vitest";
import { createMockCtx } from "@termix/plugin-sdk/testing";
import { createTokenStore } from "../../src/backend/token-store.js";
import manifestJson from "../../manifest.json";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

const manifest = manifestJson as unknown as PluginManifest;

function mockCtx(actor?: string) {
  return createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    actor,
  });
}

describe("token store", () => {
  it("stores and reads back a token for the acting user", async () => {
    const { ctx } = mockCtx("owner-1");
    const store = createTokenStore(ctx);

    await store.set("src-1", "s3cret");
    await expect(store.getForOwner("src-1", "owner-1")).resolves.toBe("s3cret");
  });

  it("reads the owner's token for a caller currently acting as someone else", async () => {
    const { ctx, setActor } = mockCtx("owner-1");
    const store = createTokenStore(ctx);
    await store.set("src-1", "s3cret");

    // A shared source's test/resolve runs as the recipient viewing it.
    setActor("recipient-1");
    await expect(store.getForOwner("src-1", "owner-1")).resolves.toBe("s3cret");
    // ctx.asUser restores the previous actor once it returns.
    expect(ctx.currentActor()).toBe("recipient-1");
  });

  it("clears a token", async () => {
    const { ctx } = mockCtx("owner-1");
    const store = createTokenStore(ctx);
    await store.set("src-1", "s3cret");
    await store.clear("src-1");
    await expect(store.getForOwner("src-1", "owner-1")).resolves.toBeNull();
  });
});
