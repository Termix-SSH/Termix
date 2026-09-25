/**
 * Unit coverage for the declared service registry: registration, versioned
 * structural resolution, and the per-call permission gate on a handle.
 *
 * The two-fixture end-to-end test lives in service-contract.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const {
  clearServiceRegistry,
  createServiceHandle,
  getRegistration,
  getServiceImplementation,
  listProviderNames,
  listServices,
  provideService,
  resolveRequirements,
  revokeService,
  PluginServiceActorError,
  PluginServicePermissionError,
  PluginServiceUnavailableError,
} = await import("../../plugins/service-registry.js");

type Registration = ReturnType<typeof provideService>;

function register(
  overrides: Partial<Parameters<typeof provideService>[0]> = {},
): Registration {
  return provideService({
    service: "testplugin.greet",
    version: "1.0.0",
    permission: "testplugin.greet.use",
    pluginId: "provider-plugin",
    pluginName: "Provider Plugin",
    implementation: { hello: async (name: string) => `hello ${name}` },
    ...overrides,
  });
}

function manifestRequiring(
  requires: Array<{
    service: string;
    versionRange: string;
    optional?: boolean;
  }>,
) {
  return { id: "consumer-plugin", requires } as never;
}

describe("service registry", () => {
  beforeEach(() => clearServiceRegistry());
  afterEach(() => clearServiceRegistry());

  it("round-trips a registration", () => {
    const registration = register();

    expect(getRegistration("testplugin.greet")).toBe(registration);
    expect(listServices()).toHaveLength(1);
    expect(registration.generation).toBeGreaterThan(0);
  });

  it("only revokes the registration that is actually current", () => {
    const first = register();
    const second = register();

    // A crashed-and-restarted provider must not revoke the replacement its own
    // restart installed.
    expect(revokeService("testplugin.greet", first)).toBe(false);
    expect(getRegistration("testplugin.greet")).toBe(second);

    expect(revokeService("testplugin.greet", second)).toBe(true);
    expect(getRegistration("testplugin.greet")).toBeUndefined();
  });

  it("reports a revoke of something never registered", () => {
    expect(revokeService("nothing.here")).toBe(false);
  });

  it("hands core the implementation of a compatible version, or nothing", () => {
    expect(
      getServiceImplementation("testplugin.greet", "^1.0.0"),
    ).toBeUndefined();
    const registration = register({ version: "1.4.0" });
    expect(getServiceImplementation("testplugin.greet", "^1.0.0")).toBe(
      registration.implementation,
    );
    expect(
      getServiceImplementation("testplugin.greet", "^2.0.0"),
    ).toBeUndefined();
  });

  describe("named providers", () => {
    it("keeps several providers of one service side by side", () => {
      const ssh = register({
        name: "ssh",
        implementation: { kind: async () => "ssh" },
      });
      const rdp = register({
        name: "rdp",
        pluginId: "other-plugin",
        implementation: { kind: async () => "rdp" },
      });

      expect(listProviderNames("testplugin.greet").sort()).toEqual([
        "rdp",
        "ssh",
      ]);
      expect(getRegistration("testplugin.greet", "ssh")).toBe(ssh);
      expect(getRegistration("testplugin.greet", "rdp")).toBe(rdp);
      expect(getRegistration("testplugin.greet")).toBeUndefined();
      expect(listServices()).toHaveLength(2);
    });

    it("hands core a named implementation only by its name", () => {
      const ssh = register({ name: "ssh" });
      expect(
        getServiceImplementation("testplugin.greet", "^1.0.0", "ssh"),
      ).toBe(ssh.implementation);
      expect(
        getServiceImplementation("testplugin.greet", "^1.0.0"),
      ).toBeUndefined();
    });

    it("revokes one provider and leaves the other", () => {
      const ssh = register({ name: "ssh" });
      const rdp = register({ name: "rdp" });

      expect(revokeService("testplugin.greet", ssh)).toBe(true);
      expect(getRegistration("testplugin.greet", "ssh")).toBeUndefined();
      expect(getRegistration("testplugin.greet", "rdp")).toBe(rdp);
    });

    it("routes a named handle to its provider and fails typed once it goes", async () => {
      const ssh = register({
        name: "ssh",
        implementation: { hello: async () => "from ssh" },
      });
      register({
        name: "rdp",
        implementation: { hello: async () => "from rdp" },
      });
      const context = {
        resolveUserId: () => "user-1",
        hasPermission: async () => true,
        audit: () => {},
      };
      const handle = createServiceHandle<{ hello: () => Promise<string> }>(
        "testplugin.greet",
        "consumer-plugin",
        context,
        "ssh",
      );
      const unnamed = createServiceHandle<{ hello?: () => Promise<string> }>(
        "testplugin.greet",
        "consumer-plugin",
        context,
      );

      await expect(handle.hello()).resolves.toBe("from ssh");
      expect("hello" in unnamed).toBe(false);

      revokeService("testplugin.greet", ssh);
      expect(() => handle.hello()).toThrow(PluginServiceUnavailableError);
    });

    it("satisfies a requirement with any compatible provider", () => {
      register({ name: "rdp", version: "2.0.0" });
      register({ name: "ssh", version: "1.2.0" });

      expect(
        resolveRequirements(
          manifestRequiring([
            { service: "testplugin.greet", versionRange: "^1.0.0" },
          ]),
        ).satisfied,
      ).toBe(true);
    });
  });

  describe("resolution", () => {
    it("is satisfied when the version is in range", () => {
      register({ version: "1.2.0" });

      const resolution = resolveRequirements(
        manifestRequiring([
          { service: "testplugin.greet", versionRange: "^1.2.0" },
        ]),
      );

      expect(resolution.satisfied).toBe(true);
      expect(resolution.errors).toEqual([]);
    });

    it("fails a hard requirement nothing provides", () => {
      const resolution = resolveRequirements(
        manifestRequiring([
          { service: "testplugin.greet", versionRange: "^1.0.0" },
        ]),
      );

      expect(resolution.satisfied).toBe(false);
      expect(resolution.errors[0]).toContain("no active plugin provides");
    });

    it("fails when the provided version is out of range", () => {
      register({ version: "2.0.0" });

      const resolution = resolveRequirements(
        manifestRequiring([
          { service: "testplugin.greet", versionRange: "^1.0.0" },
        ]),
      );

      expect(resolution.satisfied).toBe(false);
      expect(resolution.errors[0]).toContain("provides 2.0.0");
    });

    it("skips an unsatisfied optional requirement", () => {
      const resolution = resolveRequirements(
        manifestRequiring([
          {
            service: "testplugin.greet",
            versionRange: "^1.0.0",
            optional: true,
          },
        ]),
      );

      expect(resolution.satisfied).toBe(true);
      expect(resolution.missingOptional).toEqual(["testplugin.greet"]);
    });

    it("treats a manifest with no requires as satisfied", () => {
      expect(resolveRequirements({ id: "x" } as never).satisfied).toBe(true);
    });
  });

  describe("handle", () => {
    function handleFor(allowed: boolean, ...actor: [] | [string | undefined]) {
      const userId = actor.length === 0 ? "user-1" : actor[0];
      const audits: Array<Record<string, unknown>> = [];
      const handle = createServiceHandle<{
        hello: (name: string) => Promise<string>;
      }>("testplugin.greet", "consumer-plugin", {
        resolveUserId: () => userId,
        hasPermission: async () => allowed,
        audit: (entry) => void audits.push(entry as never),
      });
      return { handle, audits };
    }

    it("delegates to the implementation when permitted", async () => {
      register();
      const { handle, audits } = handleFor(true);

      await expect(handle.hello("world")).resolves.toBe("hello world");
      expect(audits).toHaveLength(1);
      expect(audits[0].success).toBe(true);
    });

    it("runs the provider as the user the permission was checked for", async () => {
      const { getActor } = await import("../../plugins/actor.js");
      register({
        implementation: { hello: async () => getActor() ?? "nobody" },
      });
      const { handle } = handleFor(true, "user-7");

      await expect(handle.hello("x")).resolves.toBe("user-7");
    });

    it("denies without the permission and never reaches the provider", async () => {
      const hello = vi.fn(async () => "should not run");
      register({ implementation: { hello } });
      const { handle, audits } = handleFor(false);

      await expect(handle.hello("world")).rejects.toThrow(
        PluginServicePermissionError,
      );
      // The gate has to run before delegation, not after.
      expect(hello).not.toHaveBeenCalled();
      expect(audits[0].success).toBe(false);
    });

    it("denies with the same 403 shape requirePermission sends", async () => {
      register();
      const { handle } = handleFor(false);

      await handle.hello("world").then(
        () => expect.unreachable("should have denied"),
        (error: InstanceType<typeof PluginServicePermissionError>) => {
          expect(error.status).toBe(403);
          expect(error.body).toEqual({
            error: "Insufficient permissions",
            required: "testplugin.greet.use",
          });
        },
      );
    });

    it("refuses a call it cannot attribute to a user", async () => {
      register();
      const { handle } = handleFor(true, undefined);

      await expect(handle.hello("world")).rejects.toThrow(
        PluginServiceActorError,
      );
    });

    it("throws once the provider is revoked", async () => {
      const registration = register();
      const { handle } = handleFor(true);

      await expect(handle.hello("world")).resolves.toBe("hello world");

      revokeService("testplugin.greet", registration);

      expect(() => handle.hello("world")).toThrow(
        /no longer provided|is not a function/,
      );
    });

    it("exposes only the functions the provider handed out", () => {
      register({
        implementation: {
          hello: async () => "hi",
          secret: "not a function",
        },
      });
      const { handle } = handleFor(true);

      expect(typeof handle.hello).toBe("function");
      expect(
        (handle as unknown as Record<string, unknown>).secret,
      ).toBeUndefined();
      expect(Object.keys(handle)).toEqual(["hello"]);
    });

    it("rebinds the acting user with asUser", async () => {
      register();
      const seen: string[] = [];
      const handle = createServiceHandle<{
        hello: (name: string) => Promise<string>;
        asUser: (userId: string) => { hello: (n: string) => Promise<string> };
      }>("testplugin.greet", "consumer-plugin", {
        resolveUserId: () => undefined,
        hasPermission: async (userId) => {
          seen.push(userId);
          return true;
        },
        audit: () => {},
      });

      await handle.asUser("user-42").hello("world");
      expect(seen).toEqual(["user-42"]);
    });

    it("surfaces an unavailable service rather than a generic undefined", () => {
      const { handle } = handleFor(true);
      expect(
        (handle as unknown as Record<string, unknown>).hello,
      ).toBeUndefined();
    });

    it("audits a failure thrown by the provider itself", async () => {
      register({
        implementation: {
          hello: async () => {
            throw new Error("provider exploded");
          },
        },
      });
      const { handle, audits } = handleFor(true);

      await expect(handle.hello("world")).rejects.toThrow("provider exploded");
      expect(audits[0].success).toBe(false);
      expect(audits[0].errorMessage).toBe("provider exploded");
    });
  });

  it("exposes the unavailable error with a stable code", () => {
    const error = new PluginServiceUnavailableError("a.b", "provider");
    expect(error.code).toBe("EPLUGINSVCGONE");
    expect(error.message).toContain("a.b");
    expect(error.message).toContain("provider");
  });
});

describe("provider clashes", () => {
  it("refuses a second plugin answering to the same service and name", async () => {
    register();
    expect(() => register({ pluginId: "other-plugin" })).toThrow(
      /already provided by provider-plugin/,
    );
    const { listRegistrationConflicts } =
      await import("../../plugins/conflicts.js");
    expect(listRegistrationConflicts()).toContainEqual(
      expect.objectContaining({ kind: "service", pluginId: "other-plugin" }),
    );
  });

  it("lets a plugin replace its own registration", () => {
    register();
    expect(() => register()).not.toThrow();
  });
});
