import { describe, it, expect } from "vitest";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix/plugin-sdk/testing";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";

const manifest = manifestJson as unknown as PluginManifest;

describe("serial activate", () => {
  it("mounts the console WS route at /console with every declared capability", async () => {
    const mock: MockPluginContext = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: manifest.capabilities,
    });

    await activate(mock.ctx);

    expect(mock.wsRoutes).toMatchObject([{ path: "/console", raw: false }]);
  });

  it("refuses to mount without network:serve", async () => {
    const mock: MockPluginContext = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: manifest.capabilities.filter((c) => c !== "network:serve"),
    });

    await expect(activate(mock.ctx)).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
  });
});
