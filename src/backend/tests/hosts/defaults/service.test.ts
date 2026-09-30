import { describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

vi.mock("../../../database/repositories/factory.js", () => ({}));
vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  hostSettingsPlugins: () => [],
}));

const { validateLevelChange } =
  await import("../../../hosts/defaults/service.js");
const { buildCatalog } = await import("../../../hosts/defaults/catalog.js");

const catalog = buildCatalog([
  {
    id: "fx",
    contributes: {
      settings: {
        host: {
          fields: [
            { key: "size", type: "number", min: 8, max: 36, default: 14 },
            { key: "snippet", type: "number", defaultLevels: ["user"] },
          ],
        },
      },
    },
  } as unknown as PluginManifest,
]);

const context = {
  actorId: "u1",
  ownerId: "u1",
  canUseCredential: async (id: number) => id === 7,
  canUseHost: async (id: number) => id === 3,
};

describe("validateLevelChange", () => {
  it("accepts known keys and normalizes their values", async () => {
    const change = await validateLevelChange(
      { level: "user", userId: "u1" },
      { set: { "core.sshPort": "2022", "fx.size": "16" }, unset: ["fx.x"] },
      context,
      catalog,
    );
    expect(change.errors).toEqual({});
    expect(change.set.get("core.sshPort")).toBe(2022);
    expect(change.set.get("fx.size")).toBe(16);
    expect([...change.unset]).toEqual(["fx.x"]);
  });

  it("refuses unknown keys, out of range values and levels a key cannot use", async () => {
    const change = await validateLevelChange(
      { level: "admin" },
      {
        set: {
          "core.name": "x",
          "fx.size": 99,
          "fx.snippet": 1,
          "core.jumpHosts": [{ hostId: 3 }],
        },
      },
      context,
      catalog,
    );
    expect(Object.keys(change.errors).sort()).toEqual([
      "core.jumpHosts",
      "core.name",
      "fx.size",
      "fx.snippet",
    ]);
  });

  it("never takes a password or key login, or a credential at the server level", async () => {
    const password = await validateLevelChange(
      { level: "user", userId: "u1" },
      { set: { "core.auth": { authType: "password" } } },
      context,
      catalog,
    );
    expect(password.errors["core.auth"]).toMatch(/cannot be a default/);

    const serverCredential = await validateLevelChange(
      { level: "admin" },
      { set: { "core.auth": { authType: "credential", credentialId: 7 } } },
      context,
      catalog,
    );
    expect(serverCredential.errors["core.auth"]).toMatch(/server default/);

    const ownCredential = await validateLevelChange(
      { level: "folder", folderId: 1, userId: "u1" },
      { set: { "core.auth": { authType: "credential", credentialId: 7 } } },
      context,
      catalog,
    );
    expect(ownCredential.errors).toEqual({});

    const otherCredential = await validateLevelChange(
      { level: "user", userId: "u1" },
      { set: { "core.auth": { authType: "credential", credentialId: 8 } } },
      context,
      catalog,
    );
    expect(otherCredential.errors["core.auth"]).toMatch(/not available/);
  });

  it("checks every jump host in a chain", async () => {
    const change = await validateLevelChange(
      { level: "user", userId: "u1" },
      { set: { "core.jumpHosts": [{ hostId: 3 }, { hostId: 4 }] } },
      context,
      catalog,
    );
    expect(change.errors["core.jumpHosts"]).toBeDefined();
  });
});
