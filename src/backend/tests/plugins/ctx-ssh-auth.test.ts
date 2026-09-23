import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  connects: [] as Array<{ target: unknown; options: Record<string, unknown> }>,
  factors: [] as Array<{ userId: string; pluginId: string; factorId: string }>,
  actor: undefined as string | undefined,
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
  };
});
vi.mock("../../plugins/actor.js", () => ({ getActor: () => h.actor }));
vi.mock("../../hosts/connect/connect-host.js", () => ({
  connectHost: async (target: unknown, options: Record<string, unknown>) => {
    h.connects.push({ target, options });
    const client = Object.assign(new EventEmitter(), { end: vi.fn() });
    return { client, jumpClient: null, dispose: vi.fn(() => client.end()) };
  },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentUserAuthRepository: () => ({
    recordSecondFactor: async (
      userId: string,
      pluginId: string,
      factorId: string,
    ) => {
      h.factors.push({ userId, pluginId, factorId });
    },
    removeSecondFactor: async () => true,
  }),
}));

const { createPluginAuth, createPluginSsh } =
  await import("../../plugins/ctx-ssh-auth.js");
const { DisposableBag } = await import("../../plugins/disposables.js");
const { getSshAuthProvider } =
  await import("../../hosts/connect/auth-provider-registry.js");
const { getLoginMethod, getSecondFactor } =
  await import("../../auth/registry.js");
const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");

function manifest(capabilities: string[], auth: Record<string, string[]> = {}) {
  return {
    id: "fixture",
    name: "Fixture",
    version: "1.0.0",
    capabilities,
    contributes: { auth },
  } as never;
}

beforeEach(() => {
  h.granted = new Set();
  h.connects = [];
  h.factors = [];
  h.actor = "user-1";
});

describe("ctx.ssh", () => {
  it("refuses without ssh:connect and credentials:use, and audits the refusal", async () => {
    const audit = vi.fn(async () => {});
    const ssh = createPluginSsh({
      manifest: manifest(["ssh:connect"]),
      bag: new DisposableBag("fixture"),
      audit,
    });
    h.granted = new Set(["ssh:connect"]);
    await expect(ssh.connect(7)).rejects.toBeInstanceOf(PluginCapabilityError);
    expect(audit).toHaveBeenCalledWith(
      "ssh_connect",
      "host 7",
      expect.objectContaining({ success: false }),
    );
    expect(h.connects).toEqual([]);
  });

  it("connects as the acting user through the pipeline and audits", async () => {
    const audit = vi.fn(async () => {});
    const ssh = createPluginSsh({
      manifest: manifest(["ssh:connect", "credentials:use"]),
      bag: new DisposableBag("fixture"),
      audit,
    });
    h.granted = new Set(["ssh:connect", "credentials:use"]);
    await ssh.connect(7, { purpose: "docker" });
    expect(h.connects).toEqual([
      {
        target: 7,
        options: expect.objectContaining({
          userId: "user-1",
          purpose: "docker",
        }),
      },
    ]);
    expect(audit).toHaveBeenCalledWith("ssh_connect", "host 7", {
      success: true,
    });
  });

  it("runs background work on a resolved host as its owner", async () => {
    h.actor = undefined;
    h.granted = new Set(["ssh:connect", "credentials:use"]);
    const ssh = createPluginSsh({
      manifest: manifest(["ssh:connect", "credentials:use"]),
      bag: new DisposableBag("fixture"),
      audit: vi.fn(async () => {}),
    });
    await ssh.connect({
      id: 3,
      ip: "h",
      port: 22,
      username: "u",
      userId: "owner",
    });
    expect(h.connects[0].options).toMatchObject({ userId: "owner" });
    await expect(ssh.connect(3)).rejects.toThrow(/acting user/);
  });

  it("closes open connections when the plugin is disposed", async () => {
    h.granted = new Set(["ssh:connect", "credentials:use"]);
    const bag = new DisposableBag("fixture");
    const ssh = createPluginSsh({
      manifest: manifest(["ssh:connect", "credentials:use"]),
      bag,
      audit: vi.fn(async () => {}),
    });
    const connection = await ssh.connect(7);
    await bag.disposeAll();
    expect(
      (connection.client as { end: ReturnType<typeof vi.fn> }).end,
    ).toHaveBeenCalled();
  });
});

describe("ctx.auth", () => {
  it("needs auth:provide and a contributes.auth entry to register anything", () => {
    const auth = createPluginAuth({
      manifest: manifest([], { sshAuthTypes: ["corp"] }),
      bag: new DisposableBag("fixture"),
      audit: vi.fn(async () => {}),
    });
    expect(() =>
      auth.registerSshAuthProvider({
        type: "corp",
        labelKey: "corp",
        prepare: async () => ({ status: "ready" }),
      }),
    ).toThrow(PluginCapabilityError);

    const declared = createPluginAuth({
      manifest: manifest(["auth:provide"], { sshAuthTypes: ["corp"] }),
      bag: new DisposableBag("fixture"),
      audit: vi.fn(async () => {}),
    });
    expect(() =>
      declared.registerSshAuthProvider({
        type: "other",
        labelKey: "other",
        prepare: async () => ({ status: "ready" }),
      }),
    ).toThrow(/contributes\.auth\.sshAuthTypes/);
  });

  it("registers an SSH auth type, checks the grant on use and removes it on dispose", async () => {
    const bag = new DisposableBag("fixture");
    const auth = createPluginAuth({
      manifest: manifest(["auth:provide"], { sshAuthTypes: ["corp"] }),
      bag,
      audit: vi.fn(async () => {}),
    });
    auth.registerSshAuthProvider({
      type: "corp",
      labelKey: "corp",
      prepare: async (config) => {
        config.password = "from-corp";
        return { status: "ready" };
      },
    });
    const provider = getSshAuthProvider("corp")!;
    expect(provider.pluginId).toBe("fixture");

    await expect(
      provider.prepare({} as never, {} as never, {} as never),
    ).rejects.toBeInstanceOf(PluginCapabilityError);

    h.granted = new Set(["auth:provide"]);
    const config: Record<string, unknown> = {};
    await provider.prepare(config as never, {} as never, {} as never);
    expect(config.password).toBe("from-corp");

    await bag.disposeAll();
    expect(getSshAuthProvider("corp")).toBeUndefined();
  });

  it("registers login methods and second factors under the plugin, and records enrolment", async () => {
    h.granted = new Set(["auth:provide"]);
    const bag = new DisposableBag("fixture");
    const audit = vi.fn(async () => {});
    const auth = createPluginAuth({
      manifest: manifest(["auth:provide"], {
        loginMethods: ["corp-sso"],
        secondFactors: ["pin"],
      }),
      bag,
      audit,
    });
    auth.registerLoginMethod({
      id: "corp-sso",
      labelKey: "corp",
      kind: "redirect",
      start: async () => ({ redirectUrl: "https://corp" }),
    });
    auth.registerSecondFactor({
      id: "pin",
      labelKey: "pin",
      isEnrolled: async () => true,
      verify: async () => true,
    });
    expect(getLoginMethod("corp-sso")?.pluginId).toBe("fixture");
    expect(getSecondFactor("fixture", "pin")).toBeDefined();

    await auth.recordEnrollment("user-1", "pin");
    expect(h.factors).toEqual([
      { userId: "user-1", pluginId: "fixture", factorId: "pin" },
    ]);
    expect(audit).toHaveBeenCalledWith(
      "auth_factor_enrolled",
      "pin for user-1",
      { success: true },
    );

    await bag.disposeAll();
    expect(getLoginMethod("corp-sso")).toBeUndefined();
    expect(getSecondFactor("fixture", "pin")).toBeUndefined();
  });
});
