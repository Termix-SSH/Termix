/**
 * ctx.credentials.resolveHostProtocol: credentials:read is checked and every
 * call audited, the owner gets their stored or credential-mode login, and a
 * shared recipient only ever sees what core's sharing rules hand them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];

const state = vi.hoisted(() => ({
  hosts: new Map<number, Record<string, unknown>>(),
  credentials: new Map<number, { username: string; password: string }>(),
  canConnect: true,
  resolution: null as Record<string, unknown> | null,
  resolverCalls: [] as Array<Record<string, unknown>>,
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
    findHostOwnerId: async (hostId: number) =>
      (state.hosts.get(hostId)?.userId as string) ?? null,
    findHostById: async (hostId: number) => state.hosts.get(hostId) ?? null,
    findCredentialByIdForUser: async (id: number) =>
      state.credentials.get(id) ?? null,
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
      canAccessHost: async () => ({ hasAccess: state.canConnect }),
    }),
  },
}));

vi.mock("../../utils/shared-host-auth-resolver.js", () => ({
  resolveRecipientSharedHostAuthentication: async (
    host: Record<string, unknown>,
  ) => {
    state.resolverCalls.push(host);
    return state.resolution;
  },
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { runAsActor } from "../../plugins/actor.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

function contextFor(capabilities: string[]) {
  const manifest = {
    id: "demo",
    name: "demo",
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities,
  } as PluginManifest;
  const handle = createPluginHandle("demo", { activate: () => {} });
  return createPluginContext(manifest, handle);
}

const baseHost = {
  id: 7,
  userId: "owner",
  name: "Win box",
  ip: "10.0.0.7",
  port: 22,
  username: "sshuser",
  password: "ssh-secret",
  jumpHosts: JSON.stringify([{ hostId: 3 }]),
  rdpUser: "admin",
  rdpPassword: "rdp-secret",
  rdpDomain: "CORP",
  rdpAuthType: null,
  rdpCredentialId: null,
};

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
  state.hosts.clear();
  state.credentials.clear();
  state.canConnect = true;
  state.resolution = null;
  state.resolverCalls.length = 0;
  state.hosts.set(7, { ...baseHost });
});

describe("ctx.credentials.resolveHostProtocol", () => {
  it("refuses without credentials:read and audits the refusal", async () => {
    grants.set("demo", []);
    const ctx = contextFor([]);

    await expect(
      runAsActor("owner", "request", () =>
        ctx.credentials.resolveHostProtocol(7, "rdp"),
      ),
    ).rejects.toThrow(/credentials:read/);
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_credentials_read",
      success: false,
    });
  });

  it("returns the owner's stored login and audits it", async () => {
    grants.set("demo", ["credentials:read"]);
    const ctx = contextFor(["credentials:read"]);

    const target = await runAsActor("owner", "request", () =>
      ctx.credentials.resolveHostProtocol(7, "rdp"),
    );
    expect(target).toEqual({
      host: {
        id: 7,
        name: "Win box",
        ip: "10.0.0.7",
        port: 22,
        ownerUserId: "owner",
        jumpHosts: [{ hostId: 3 }],
      },
      shared: false,
      auth: {
        authType: "direct",
        username: "admin",
        password: "rdp-secret",
        domain: "CORP",
      },
    });
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_credentials_read",
      success: true,
    });
  });

  it("uses the stored credential in credential mode", async () => {
    grants.set("demo", ["credentials:read"]);
    state.hosts.set(7, {
      ...baseHost,
      vncCredentialId: 11,
      vncAuthType: "credential",
    });
    state.credentials.set(11, { username: "viewer", password: "vnc-pass" });
    const ctx = contextFor(["credentials:read"]);

    const target = await runAsActor("owner", "request", () =>
      ctx.credentials.resolveHostProtocol(7, "vnc"),
    );
    expect(target?.auth).toMatchObject({
      authType: "credential",
      username: "viewer",
      password: "vnc-pass",
    });
  });

  it("never hands a shared recipient the owner's raw secrets", async () => {
    grants.set("demo", ["credentials:read"]);
    state.resolution = {
      source: "owner-shared",
      authType: "direct",
      secret: { username: "shared", password: "snap", domain: null },
    };
    const ctx = contextFor(["credentials:read"]);

    const target = await runAsActor("guest", "request", () =>
      ctx.credentials.resolveHostProtocol(7, "rdp"),
    );
    expect(target?.shared).toBe(true);
    expect(target?.auth).toMatchObject({
      username: "shared",
      password: "snap",
    });
    expect(state.resolverCalls[0]).toMatchObject({
      password: null,
      rdpUser: null,
      rdpPassword: null,
    });
  });

  it("gives a recipient with nothing shared an empty login", async () => {
    grants.set("demo", ["credentials:read"]);
    state.resolution = { source: "required" };
    const ctx = contextFor(["credentials:read"]);

    const target = await runAsActor("guest", "request", () =>
      ctx.credentials.resolveHostProtocol(7, "telnet"),
    );
    expect(target?.auth.username).toBe("");
    expect(target?.auth.password).toBe("");
  });

  it("returns null without connect access or for a missing host", async () => {
    grants.set("demo", ["credentials:read"]);
    state.canConnect = false;
    const ctx = contextFor(["credentials:read"]);

    await expect(
      runAsActor("guest", "request", () =>
        ctx.credentials.resolveHostProtocol(7, "rdp"),
      ),
    ).resolves.toBeNull();
    await expect(
      runAsActor("owner", "request", () =>
        ctx.credentials.resolveHostProtocol(99, "rdp"),
      ),
    ).resolves.toBeNull();
    expect(auditEntries.at(-1)).toMatchObject({ success: false });
  });
});
