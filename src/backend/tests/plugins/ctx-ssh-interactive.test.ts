/**
 * The ctx.ssh members an interactive transport (the terminal) needs: host
 * resolution with secrets, prepare with its provider hooks bound, and the
 * browser sign-in start and cancel that used to be reached by import.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  actor: "user-1" as string | undefined,
  resolved: [] as Array<{ by: string; ref: unknown; userId: string }>,
  built: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { pluginLogger: log, sshLogger: log, logger: log, authLogger: log };
});
vi.mock("../../plugins/permissions.js", async () => {
  const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");
  return {
    assertCapability: async (
      pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => {
      if (!declared.includes(capability) || !h.granted.has(capability)) {
        throw new PluginCapabilityError(pluginId, capability);
      }
    },
    hasCapability: async (
      _pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => declared.includes(capability) && h.granted.has(capability),
    hasCachedCapability: (
      _pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => declared.includes(capability) && h.granted.has(capability),
    warmPluginGrants: () => {},
    capabilityRefused: (pluginId: string, capability: string) =>
      new PluginCapabilityError(pluginId, capability),
  };
});
vi.mock("../../plugins/actor.js", () => ({ getActor: () => h.actor }));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async (_userId: string, hostId: number) => ({
        hasAccess: hostId !== 7,
      }),
    }),
  },
}));
vi.mock("../../hosts/connect/core-providers.js", () => ({
  ensureCoreSshAuthProviders: () => {},
}));
vi.mock("../../hosts/host-resolver.js", () => ({
  resolveHostById: async (id: number, userId: string) => {
    h.resolved.push({ by: "id", ref: id, userId });
    return id === 404 ? null : { id, ip: "10.0.0.1", password: "pw" };
  },
  resolveHostBySyncId: async (syncId: string, userId: string) => {
    h.resolved.push({ by: "syncId", ref: syncId, userId });
    return { id: 9, ip: "10.0.0.9" };
  },
}));
vi.mock("../../hosts/connect/build-connect-config.js", () => ({
  buildConnectConfig: async (
    _host: unknown,
    options: Record<string, unknown>,
  ) => {
    h.built.push(options);
    return {
      config: { host: "10.0.0.1" },
      outcome: { status: "ready" },
      env: { interactive: options.interactive },
      provider: {
        type: "fixture-auth",
        onBanner: (banner: string, _host: unknown, env: unknown) => ({
          action: "hold",
          timeoutMs: 1,
          message: banner,
          details: { env },
        }),
        onAuthFailed: () => ({ status: "retry", patch: {}, message: "again" }),
      },
    };
  },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostById: async (hostId: number) =>
      hostId === 1
        ? {
            id: 1,
            name: "box",
            ip: "10.0.0.1",
            username: "root",
            authType: "fixture-auth",
          }
        : null,
  }),
}));

const { createPluginSsh } = await import("../../plugins/ctx-ssh-auth.js");
const { DisposableBag } = await import("../../plugins/disposables.js");
const { registerSshAuthProvider, resetSshAuthRegistryForTests } =
  await import("../../hosts/connect/auth-provider-registry.js");
const { PluginCapabilityError, PluginSshInteractionError } =
  await import("@termix/plugin-sdk/backend");

const ALL = ["ssh:connect", "credentials:use", "credentials:read"];

function sshWith(capabilities = ALL) {
  const audit = vi.fn(async () => {});
  const ssh = createPluginSsh({
    manifest: {
      id: "fixture",
      name: "Fixture",
      version: "1.0.0",
      capabilities,
    } as never,
    bag: new DisposableBag("fixture"),
    audit,
  });
  return { ssh, audit };
}

beforeEach(() => {
  h.granted = new Set(ALL);
  h.actor = "user-1";
  h.resolved = [];
  h.built = [];
  resetSshAuthRegistryForTests();
});

describe("ctx.ssh.resolveHost", () => {
  it("resolves by sync id first, as the acting user, and audits", async () => {
    const { ssh, audit } = sshWith();
    expect(await ssh.resolveHost(3, { syncId: "abc" })).toMatchObject({
      id: 9,
    });
    expect(await ssh.resolveHost(3)).toMatchObject({ id: 3, password: "pw" });
    expect(h.resolved).toEqual([
      { by: "syncId", ref: "abc", userId: "user-1" },
      { by: "id", ref: 3, userId: "user-1" },
    ]);
    expect(audit).toHaveBeenCalledWith("ssh_resolve_host", "host 3", {
      success: true,
    });
  });

  it("hides the secrets from a plugin without credentials:read", async () => {
    h.granted = new Set(["ssh:connect", "credentials:use"]);
    const { ssh } = sshWith(["ssh:connect", "credentials:use"]);
    const host = await ssh.resolveHost(3);
    expect(host).toMatchObject({ id: 3, ip: "10.0.0.1" });
    expect(host).not.toHaveProperty("password");
  });

  it("answers null for a host this user cannot reach", async () => {
    const { ssh } = sshWith();
    expect(await ssh.resolveHost(404)).toBeNull();
  });

  it("refuses without credentials:use", async () => {
    h.granted = new Set(["ssh:connect"]);
    const { ssh } = sshWith(["ssh:connect"]);
    await expect(ssh.resolveHost(3)).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
    expect(h.resolved).toEqual([]);
  });
});

describe("ctx.ssh.prepare", () => {
  it("needs credentials:read, because its config carries the secrets", async () => {
    h.granted = new Set(["ssh:connect", "credentials:use"]);
    const { ssh } = sshWith(["ssh:connect", "credentials:use"]);
    await expect(
      ssh.prepare(
        { id: 1, ip: "10.0.0.1", port: 22, username: "root" },
        { client: {} },
      ),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
    expect(h.built).toEqual([]);
  });

  it("passes the terminal purpose, interactivity and host key socket through", async () => {
    const { ssh } = sshWith();
    const socket = { send: vi.fn() };
    await ssh.prepare(
      { id: 1, ip: "10.0.0.1", port: 22, username: "root" },
      {
        purpose: "terminal",
        client: {},
        interactive: true,
        hostKeySocket: socket,
      },
    );
    expect(h.built[0]).toMatchObject({
      purpose: "terminal",
      interactive: true,
      hostKeySocket: socket,
      userId: "user-1",
    });
  });

  it("hands back the provider's hooks bound to this host", async () => {
    const { ssh } = sshWith();
    const prepared = await ssh.prepare(
      { id: 1, ip: "10.0.0.1", port: 22, username: "root" },
      { client: {}, interactive: true },
    );
    expect(prepared.authType).toBe("fixture-auth");
    expect(prepared.onBanner?.("waiting")).toMatchObject({
      action: "hold",
      message: "waiting",
      details: { env: { interactive: true } },
    });
    expect(
      prepared.onAuthFailed?.({
        error: new Error("x"),
        retries: 0,
        canRetry: true,
        methodNotAvailable: false,
      }),
    ).toMatchObject({ status: "retry" });
  });
});

describe("ctx.ssh browser sign-in", () => {
  it("starts the interaction on the host's own provider", async () => {
    const started = vi.fn(async () => {});
    registerSshAuthProvider({
      type: "fixture-auth",
      pluginId: "core",
      labelKey: "k",
      interaction: "fixture",
      startInteraction: started,
      prepare: async () => ({ status: "ready" }),
    });
    const { ssh } = sshWith();
    await ssh.startInteraction("fixture", {
      hostId: 1,
      socket: "ws",
      requestOrigin: "https://termix.example",
    });
    expect(started).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        hostId: 1,
        socket: "ws",
        requestOrigin: "https://termix.example",
        host: { name: "box", ip: "10.0.0.1", username: "root" },
      }),
    );
  });

  it("will not start one for a host the actor cannot reach", async () => {
    const started = vi.fn(async () => {});
    registerSshAuthProvider({
      type: "fixture-auth",
      pluginId: "core",
      labelKey: "k",
      interaction: "fixture",
      startInteraction: started,
      prepare: async () => ({ status: "ready" }),
    });
    const { ssh } = sshWith();
    await expect(
      ssh.startInteraction("fixture", {
        hostId: 7,
        socket: null,
        requestOrigin: "",
      }),
    ).rejects.toBeInstanceOf(PluginSshInteractionError);
    expect(started).not.toHaveBeenCalled();
  });

  it("says why when nothing can start it", async () => {
    const { ssh } = sshWith();
    await expect(
      ssh.startInteraction("fixture", {
        hostId: 1,
        socket: null,
        requestOrigin: "",
      }),
    ).rejects.toBeInstanceOf(PluginSshInteractionError);
    await expect(
      ssh.startInteraction("fixture", {
        hostId: 2,
        socket: null,
        requestOrigin: "",
      }),
    ).rejects.toThrow("Host not found");
  });

  it("cancels on every provider that owns the interaction", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const other = vi.fn();
    for (const [type, interaction, cancel] of [
      ["a", "fixture", first],
      ["b", "fixture", second],
      ["c", "elsewhere", other],
    ] as const) {
      registerSshAuthProvider({
        type,
        pluginId: "core",
        labelKey: "k",
        interaction,
        cancelInteraction: cancel,
        prepare: async () => ({ status: "ready" }),
      });
    }
    const { ssh } = sshWith();
    await ssh.cancelInteraction("fixture", { requestId: "r1" });
    expect(first).toHaveBeenCalledWith({ userId: "user-1", requestId: "r1" });
    expect(second).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  });
});
