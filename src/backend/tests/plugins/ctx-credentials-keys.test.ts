/**
 * ctx.credentials.publicKey and resolveKeyRefs, and the capability gate on
 * ctx.ssh.exec.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import ssh2 from "ssh2";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];
const state = vi.hoisted(() => ({
  permissions: new Set<string>(["credentials.view"]),
  credential: null as Record<string, unknown> | null,
  resolve: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      (grants.get(pluginId) ?? []).map((capability) => ({
        pluginId,
        capability,
      })),
  }),
  createCurrentHostResolutionRepository: () => ({
    findCredentialByIdForUser: async () => state.credential,
  }),
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async (_user: string, name: string) =>
        state.permissions.has(name),
    }),
  },
}));
vi.mock("../../hosts/stored-ssh-key.js", () => ({
  resolveKeyReferences: state.resolve,
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { runAsActor } from "../../plugins/actor.js";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";

function contextFor(capabilities: string[]) {
  const manifest = {
    id: "demo",
    name: "demo",
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=26.10.3", api: "1" },
    capabilities,
  } as PluginManifest;
  return createPluginContext(
    manifest,
    createPluginHandle("demo", { activate: () => {} }),
  );
}

const asUser = <T>(fn: () => Promise<T>) => runAsActor("user-1", "request", fn);

const pair = ssh2.utils.generateKeyPairSync("ed25519");

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
  state.permissions = new Set(["credentials.view"]);
  state.credential = null;
  state.resolve.mockReset();
});

describe("ctx.credentials.publicKey", () => {
  it("refuses without credentials:use", async () => {
    grants.set("demo", []);
    const ctx = contextFor([]);
    await expect(asUser(() => ctx.credentials.publicKey(1))).rejects.toThrow(
      /credentials:use/,
    );
  });

  it("refuses when the user lacks credentials.view", async () => {
    grants.set("demo", ["credentials:use"]);
    state.permissions = new Set();
    const ctx = contextFor(["credentials:use"]);
    await expect(asUser(() => ctx.credentials.publicKey(1))).rejects.toThrow(
      /credentials.view/,
    );
    expect(auditEntries.at(-1)).toMatchObject({ success: false });
  });

  it("returns null for a missing credential or one that is not a key", async () => {
    grants.set("demo", ["credentials:use"]);
    const ctx = contextFor(["credentials:use"]);
    expect(await asUser(() => ctx.credentials.publicKey(1))).toBeNull();
    state.credential = { id: 1, authType: "password" };
    expect(await asUser(() => ctx.credentials.publicKey(1))).toBeNull();
  });

  it("returns the stored public key", async () => {
    grants.set("demo", ["credentials:use"]);
    state.credential = {
      id: 1,
      authType: "key",
      publicKey: " ssh-ed25519 AAA ",
    };
    const ctx = contextFor(["credentials:use"]);
    expect(await asUser(() => ctx.credentials.publicKey(1))).toBe(
      "ssh-ed25519 AAA",
    );
  });

  it("derives it from the private key behind a reference", async () => {
    grants.set("demo", ["credentials:use"]);
    state.credential = { id: 1, authType: "key", key: "op://vault/key" };
    state.resolve.mockResolvedValue({ key: pair.private });
    const ctx = contextFor(["credentials:use"]);
    const result = await asUser(() => ctx.credentials.publicKey(1));
    expect(result).toMatch(/^ssh-ed25519 /);
    expect(state.resolve).toHaveBeenCalledWith(
      "user-1",
      "op://vault/key",
      null,
    );
  });

  it("rejects a bad id", async () => {
    grants.set("demo", ["credentials:use"]);
    const ctx = contextFor(["credentials:use"]);
    await expect(asUser(() => ctx.credentials.publicKey(0))).rejects.toThrow(
      /credential id/,
    );
  });
});

describe("ctx.credentials.resolveKeyRefs", () => {
  it("refuses with only credentials:use", async () => {
    grants.set("demo", ["credentials:use"]);
    const ctx = contextFor(["credentials:use"]);
    await expect(
      asUser(() => ctx.credentials.resolveKeyRefs("op://a")),
    ).rejects.toThrow(/credentials:read/);
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("resolves for the acting user and audits", async () => {
    grants.set("demo", ["credentials:read"]);
    state.resolve.mockResolvedValue({ key: "KEY", passphrase: "PW" });
    const ctx = contextFor(["credentials:read"]);
    const result = await asUser(() =>
      ctx.credentials.resolveKeyRefs("op://a", "op://b"),
    );
    expect(result).toEqual({ key: "KEY", passphrase: "PW" });
    expect(state.resolve).toHaveBeenCalledWith("user-1", "op://a", "op://b");
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_credentials_resolve_key",
      success: true,
    });
  });
});

describe("ctx.ssh.exec", () => {
  it("refuses without ssh:connect and credentials:use", async () => {
    grants.set("demo", []);
    const ctx = contextFor([]);
    await expect(asUser(() => ctx.ssh.exec(1, "id"))).rejects.toThrow(
      /ssh:connect/,
    );
  });
});
