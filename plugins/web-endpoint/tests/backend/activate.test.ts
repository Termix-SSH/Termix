import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";

const manifest = manifestJson as unknown as PluginManifest;

let mock: MockPluginContext | null = null;

afterEach(async () => {
  for (const dispose of [...(mock?.disposals ?? [])].reverse()) await dispose();
  mock = null;
});

function activateWith(capabilities: string[]) {
  mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities,
    router: () => express.Router(),
  });
  return activate(mock.ctx);
}

describe("web-endpoint activate", () => {
  it("mounts its router at /plugin-api/web-endpoint", async () => {
    await activateWith(manifest.capabilities);
    expect(mock?.httpRouters).toHaveLength(1);
  });

  it("registers a hostImportNormalizer and revokes it on deactivate", async () => {
    await activateWith(manifest.capabilities);
    expect(
      typeof mock?.ctx.registry.consume("web-endpoint.hostImportNormalizer"),
    ).toBe("function");

    for (const dispose of [...(mock?.disposals ?? [])].reverse())
      await dispose();
    expect(
      mock?.ctx.registry.consume("web-endpoint.hostImportNormalizer"),
    ).toBeUndefined();
  });

  it("fails closed without network:serve", async () => {
    await expect(
      activateWith(manifest.capabilities.filter((c) => c !== "network:serve")),
    ).rejects.toThrow(/network:serve/);
  });
});
