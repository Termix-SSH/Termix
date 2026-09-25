import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  connects: [] as Array<{ target: unknown; options: Record<string, unknown> }>,
  factors: [] as Array<{ userId: string; pluginId: string; factorId: string }>,
  actor: undefined as string | undefined,
  cleared: [] as string[],
  clearedAll: 0,
  pooled: [] as string[],
  sessionId: undefined as string | undefined,
  revoked: [] as Array<{ userId: string; except?: string }>,
  trustedCleared: [] as string[],
  policyError: null as Error | null,
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
vi.mock("../../plugins/actor.js", () => ({
  getActor: () => h.actor,
  getActorSessionId: () => h.sessionId,
}));
vi.mock("../../auth/core-auth.js", () => ({
  assertSecondFactorEnrollmentAllowed: () => {
    if (h.policyError) throw h.policyError;
  },
}));
vi.mock("../../hosts/ssh-connection-pool.js", () => ({
  withConnection: async (
    key: string,
    factory: () => Promise<unknown>,
    fn: (client: unknown) => Promise<unknown>,
  ) => {
    h.pooled.push(key);
    return fn(await factory());
  },
  connectionPool: {
    clearKeyConnections: (key: string) => h.cleared.push(key),
    clearAllConnections: () => {
      h.clearedAll += 1;
    },
  },
}));
vi.mock("../../hosts/connect/connect-host.js", () => ({
  resolveConnectHost: async (target: unknown) =>
    typeof target === "number"
      ? {
          id: target,
          userId: "user-1",
          ip: `10.0.0.${target}`,
          port: 22,
          username: "root",
        }
      : target,
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
  createCurrentSessionRepository: () => ({
    revokeAllForUser: async (userId: string, except?: string) => {
      h.revoked.push({ userId, except });
      return 0;
    },
  }),
  createCurrentTrustedDeviceRepository: () => ({
    deleteByUserId: async (userId: string) => {
      h.trustedCleared.push(userId);
    },
  }),
}));

const { createPluginAuth, createPluginSsh } =
  await import("../../plugins/ctx-ssh-auth.js");
const { DisposableBag } = await import("../../plugins/disposables.js");
const { getSshAuthProvider } =
  await import("../../hosts/connect/auth-provider-registry.js");
const { classifyKeyboardInteractive } =
  await import("../../hosts/connect/keyboard-interactive.js");
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
  h.cleared = [];
  h.clearedAll = 0;
  h.pooled = [];
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

  it("passes a given stream through to the pipeline, gated like any connect", async () => {
    const stream = { throughSource: true };
    const ssh = createPluginSsh({
      manifest: manifest(["ssh:connect", "credentials:use"]),
      bag: new DisposableBag("fixture"),
      audit: vi.fn(async () => {}),
    });
    h.granted = new Set(["ssh:connect"]);
    await expect(ssh.connect(7, { sock: stream })).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
    expect(h.connects).toEqual([]);

    h.granted = new Set(["ssh:connect", "credentials:use"]);
    await ssh.connect(7, { purpose: "tunnel", sock: stream });
    expect(h.connects[0].options).toMatchObject({
      purpose: "tunnel",
      sock: stream,
    });
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

describe("ctx.ssh pooled connections", () => {
  const both = ["ssh:connect", "credentials:use"];

  function plugin(id: string) {
    const bag = new DisposableBag(id);
    const ssh = createPluginSsh({
      manifest: { ...(manifest(both) as object), id } as never,
      bag,
      audit: vi.fn(async () => {}),
    });
    return { bag, ssh };
  }

  it("disabling one plugin leaves ctx.ssh and the pool working for others", async () => {
    h.granted = new Set(both);
    const metrics = plugin("host-metrics");
    const other = plugin("fleets");

    await metrics.ssh.withConnection(7, { pool: "stats" }, async () => "a");
    await other.ssh.withConnection(8, { pool: "fleet" }, async () => "b");
    await metrics.bag.disposeAll();

    expect(h.clearedAll).toBe(0);
    expect(h.cleared).toEqual(["stats:user-1:10.0.0.7:22:root"]);
    await expect(
      other.ssh.withConnection(8, { pool: "fleet" }, async () => "still"),
    ).resolves.toBe("still");
  });

  it("dropPooled clears only this plugin's keys for that host", async () => {
    h.granted = new Set(both);
    const metrics = plugin("host-metrics");
    await metrics.ssh.withConnection(7, { pool: "stats" }, async () => 1);
    await metrics.ssh.withConnection(8, { pool: "stats" }, async () => 1);

    metrics.ssh.dropPooled("stats", 7);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.cleared).toEqual(["stats:user-1:10.0.0.7:22:root"]);

    // Dropped keys are forgotten, so deactivate only clears what is left.
    h.cleared = [];
    await metrics.bag.disposeAll();
    expect(h.cleared).toEqual(["stats:user-1:10.0.0.8:22:root"]);
  });

  it("dropPooled ignores another pool and an unknown host", async () => {
    h.granted = new Set(both);
    const metrics = plugin("host-metrics");
    await metrics.ssh.withConnection(7, { pool: "stats" }, async () => 1);
    metrics.ssh.dropPooled("other", 7);
    metrics.ssh.dropPooled("stats", 99);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.cleared).toEqual([]);
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

  it("registers a keyboard-interactive handler that sees only its own host settings", async () => {
    const bag = new DisposableBag("fixture");
    const auth = createPluginAuth({
      manifest: manifest(["auth:provide"], { keyboardInteractive: ["gate"] }),
      bag,
      audit: vi.fn(async () => {}),
    });
    const seen: Array<Record<string, unknown>> = [];
    auth.registerKeyboardInteractiveHandler({
      id: "gate",
      label: "Gate",
      detect: (round, _host, settings) => {
        seen.push(settings);
        return /gate/i.test(round.name)
          ? {
              kind: "browser",
              url: "https://gate",
              code: "AB12",
              instructions: "",
            }
          : null;
      },
      autoAnswerPasswords: (_host, settings) => settings.on === true,
    });

    const target = {
      id: 1,
      ip: "10.0.0.1",
      port: 22,
      username: "root",
      password: "pw",
      pluginSettings: { fixture: { on: true }, other: { secret: "x" } },
    };
    expect(
      classifyKeyboardInteractive(
        { name: "Gate sign-in", instructions: "", prompts: [] },
        target,
      ),
    ).toEqual({
      kind: "browser",
      id: "gate",
      label: "Gate",
      url: "https://gate",
      code: "AB12",
      instructions: "",
    });
    expect(seen[0]).toEqual({ on: true });
    expect(
      classifyKeyboardInteractive(
        {
          name: "",
          instructions: "",
          prompts: [{ prompt: "Password:", echo: false }],
        },
        target,
      ),
    ).toEqual({ kind: "auto", responses: ["pw"] });

    await bag.disposeAll();
    expect(
      classifyKeyboardInteractive(
        { name: "Gate sign-in", instructions: "", prompts: [] },
        target,
      ).kind,
    ).not.toBe("browser");
  });

  it("refuses a keyboard-interactive handler that is not declared", () => {
    const auth = createPluginAuth({
      manifest: manifest(["auth:provide"], { keyboardInteractive: ["gate"] }),
      bag: new DisposableBag("fixture"),
      audit: vi.fn(async () => {}),
    });
    expect(() =>
      auth.registerKeyboardInteractiveHandler({
        id: "other",
        label: "Other",
        detect: () => null,
      }),
    ).toThrow(/contributes\.auth\.keyboardInteractive/);

    const undeclared = createPluginAuth({
      manifest: manifest([], { keyboardInteractive: ["gate"] }),
      bag: new DisposableBag("fixture"),
      audit: vi.fn(async () => {}),
    });
    expect(() =>
      undeclared.registerKeyboardInteractiveHandler({
        id: "gate",
        label: "Gate",
        detect: () => null,
      }),
    ).toThrow(PluginCapabilityError);
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

  it("revokes other sessions and trusted devices on enrolment, keeping the caller's session", async () => {
    h.granted = new Set(["auth:provide"]);
    h.factors = [];
    h.revoked = [];
    h.trustedCleared = [];
    h.policyError = null;
    h.actor = "user-1";
    h.sessionId = "session-a";
    const auth = createPluginAuth({
      manifest: manifest(["auth:provide"], { secondFactors: ["pin"] }),
      bag: new DisposableBag("fixture"),
      audit: vi.fn(async () => {}),
    });
    await auth.recordEnrollment("user-1", "pin");
    expect(h.revoked).toEqual([{ userId: "user-1", except: "session-a" }]);
    expect(h.trustedCleared).toEqual(["user-1"]);
    h.actor = undefined;
    h.sessionId = undefined;
  });

  it("refuses enrolment when core policy forbids second factors", async () => {
    h.granted = new Set(["auth:provide"]);
    h.factors = [];
    const { LoginMethodError } = await import("@termix/plugin-sdk/backend");
    h.policyError = new LoginMethodError("password login is off", 409);
    const auth = createPluginAuth({
      manifest: manifest(["auth:provide"], { secondFactors: ["pin"] }),
      bag: new DisposableBag("fixture"),
      audit: vi.fn(async () => {}),
    });
    await expect(auth.recordEnrollment("user-1", "pin")).rejects.toMatchObject({
      status: 409,
    });
    expect(h.factors).toEqual([]);
    h.policyError = null;
  });
});
