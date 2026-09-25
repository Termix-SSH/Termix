import { describe, expect, it } from "vitest";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { createMockCtx } from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";
import { detectWarpgateRound } from "../../src/backend/detect.js";
import { hostImportNormalizer } from "../../src/backend/host-import.js";

const manifest = manifestJson as unknown as PluginManifest;
const HOST = { id: 1, ip: "10.0.0.1", port: 22, username: "root" };

async function register() {
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
  });
  await activate(mock.ctx);
  return mock.auth.keyboardInteractiveHandlers[0];
}

describe("detectWarpgateRound", () => {
  it("claims a Warpgate round with its URL and security key", () => {
    expect(
      detectWarpgateRound({
        name: "Warpgate authentication",
        instructions:
          "Open https://gate.example/@warpgate#/login/abc to continue. Security key: a b c d",
        prompts: [{ prompt: "Press Enter when done: " }],
      }),
    ).toEqual({
      kind: "browser",
      url: "https://gate.example/@warpgate#/login/abc",
      code: "a b c d",
      instructions:
        "Open https://gate.example/@warpgate#/login/abc to continue. Security key: a b c d",
    });
  });

  it("finds the marker in a prompt too, and says N/A without a key", () => {
    expect(
      detectWarpgateRound({
        name: "",
        instructions: "",
        prompts: [
          { prompt: "Warpgate authentication: visit https://gate.example/x" },
        ],
      }),
    ).toMatchObject({ url: "https://gate.example/x", code: "N/A" });
  });

  it("leaves other rounds, and a Warpgate round without a URL, alone", () => {
    expect(
      detectWarpgateRound({
        name: "",
        instructions: "",
        prompts: [{ prompt: "Verification code:" }],
      }),
    ).toBeNull();
    expect(
      detectWarpgateRound({
        name: "Warpgate authentication",
        instructions: "",
        prompts: [],
      }),
    ).toBeNull();
  });
});

describe("the warpgate handler", () => {
  it("registers under its id and label", async () => {
    const handler = await register();
    expect(handler).toMatchObject({ id: "warpgate", label: "Warpgate" });
  });

  it("answers password prompts itself only on hosts with the setting on", async () => {
    const handler = await register();
    expect(handler.autoAnswerPasswords!(HOST, { useWarpgate: true })).toBe(
      true,
    );
    expect(handler.autoAnswerPasswords!(HOST, { useWarpgate: false })).toBe(
      false,
    );
    expect(handler.autoAnswerPasswords!(HOST, {})).toBe(false);
  });

  it("fails closed without auth:provide", async () => {
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: [],
    });
    await expect(activate(mock.ctx)).rejects.toThrow(PluginCapabilityError);
  });
});

describe("hostImportNormalizer", () => {
  it("reads the plugin's own settings first, then the 2.8 host field", () => {
    expect(
      hostImportNormalizer({
        pluginSettings: { warpgate: { useWarpgate: true } },
      }),
    ).toEqual({ useWarpgate: true });
    expect(hostImportNormalizer({ useWarpgate: 1 })).toEqual({
      useWarpgate: true,
    });
    expect(hostImportNormalizer({ useWarpgate: false })).toEqual({
      useWarpgate: false,
    });
    expect(hostImportNormalizer({ name: "x" })).toBeNull();
  });
});
