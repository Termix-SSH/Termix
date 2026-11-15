/**
 * Login methods and second factors the shell draws by itself: what the public
 * list carries, passkey options, and the WebAuthn steps a plugin screen runs
 * through the shell.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import {
  createAuthState,
  fakeAuthManager,
  fakeRequest,
  fakeResponse,
  type AuthState,
} from "../auth/auth-test-helpers.js";

const h = vi.hoisted(() => ({
  state: null as unknown as AuthState,
  manager: null as unknown as ReturnType<
    typeof import("../auth/auth-test-helpers.js").fakeAuthManager
  >,
  granted: new Set<string>(),
  trustedProxy: false,
  audits: [] as string[],
}));

vi.mock("../../database/repositories/factory.js", async () => {
  const helpers = await import("../auth/auth-test-helpers.js");
  const names = Object.keys(helpers.fakeFactory(helpers.createAuthState()));
  return Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]) =>
        (
          helpers.fakeFactory(h.state) as Record<
            string,
            (...a: unknown[]) => unknown
          >
        )[name](...args),
    ]),
  );
});
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => h.manager },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    h.state.audits.push(entry);
  },
  getRequestMeta: () => ({ ipAddress: "10.0.0.1", userAgent: "test" }),
}));
vi.mock("../../utils/trusted-proxy-auth.js", () => ({
  isTrustedProxyAuthEnabled: () => h.trustedProxy,
}));
vi.mock("../../plugins/permissions.js", async () => {
  const { PluginCapabilityError } =
    await import("@termix-ssh/plugin-sdk/backend");
  return {
    capabilityRefused: (pluginId: string, capability: string) =>
      new PluginCapabilityError(pluginId, capability),
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
vi.mock("../../hosts/internal-events.js", () => ({
  emitInternalEvent: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
  return {
    authLogger: log,
    databaseLogger: log,
    sshLogger: log,
    pluginLogger: log,
    logger: log,
  };
});
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({ invalidateUserPermissionCache: vi.fn() }),
  },
}));
vi.mock("../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ snapshotForUserRoles: async () => {} }),
  },
}));
vi.mock("../../utils/shared-credential-secrets-manager.js", () => ({
  SharedCredentialSecretsManager: {
    getInstance: () => ({ snapshotForUserRoles: async () => {} }),
  },
}));

const { createPluginAuth } = await import("../../plugins/ctx-ssh-auth.js");
const { DisposableBag } = await import("../../plugins/disposables.js");
const {
  listPublicLoginMethods,
  webauthnLoginOptions,
  listPublicSecondFactors,
} = await import("../../database/routes/auth-routes.js");
const { resetAuthRegistryForTests } = await import("../../auth/registry.js");
const { resetCoreLoginProvidersForTests } =
  await import("../../auth/core-auth.js");
const { registerSecondFactor } = await import("../../auth/registry.js");
const { startCeremony, finishCeremony, resetCeremonies, CeremonyError } =
  await import("../../auth/webauthn-ceremonies.js");

const manifest = {
  id: "keys",
  capabilities: ["auth:provide"],
  contributes: {
    auth: { loginMethods: ["passkey", "dir"], secondFactors: ["key"] },
  },
} as unknown as PluginManifest;

const OPTIONS = { challenge: "abc", allowCredentials: [] };

function setup(plugin: PluginManifest = manifest) {
  const bag = new DisposableBag();
  const auth = createPluginAuth({
    manifest: plugin,
    bag,
    audit: async (action) => {
      h.audits.push(action);
    },
  });
  return { auth, bag };
}

beforeEach(() => {
  h.state = createAuthState();
  h.manager = fakeAuthManager(h.state);
  h.granted = new Set(["auth:provide"]);
  h.trustedProxy = false;
  h.audits = [];
  resetAuthRegistryForTests();
  resetCoreLoginProvidersForTests();
  resetCeremonies();
});

describe("methods the shell draws", () => {
  it("lists fields, placement and views, and drops bad fields", async () => {
    const { auth } = setup();
    auth.registerLoginMethod({
      id: "dir",
      labelKey: "dir.title",
      kind: "form",
      fields: [
        { name: "username", type: "text", labelKey: "username" },
        { name: "password", type: "password", labelKey: "password" },
        { name: "bad name", type: "text", labelKey: "x" },
        { name: "script", type: "html", labelKey: "x" } as never,
      ],
      describe: async () => [
        { id: "1", label: "Corp", enabled: true, views: ["external"] },
      ],
      verify: async () => ({ kind: "user", userId: "u1" }),
    });
    const dir = (await listPublicLoginMethods()).find((m) => m.id === "dir");
    expect(dir?.fields).toEqual([
      { name: "username", type: "text", labelKey: "username" },
      { name: "password", type: "password", labelKey: "password" },
    ]);
    expect(dir?.instances).toEqual([
      { id: "1", label: "Corp", views: ["external"] },
    ]);
  });

  it("needs options and verify for a passkey method", () => {
    const { auth } = setup();
    expect(() =>
      auth.registerLoginMethod({
        id: "passkey",
        labelKey: "signIn",
        kind: "webauthn",
        verify: async () => ({ kind: "user", userId: "u1" }),
      }),
    ).toThrow(/options and verify/);
  });

  it("gives passkey options through core", async () => {
    const { auth } = setup();
    auth.registerLoginMethod({
      id: "passkey",
      labelKey: "signIn",
      kind: "webauthn",
      placement: "inline",
      options: async (request) => ({
        publicKey: { ...OPTIONS, user: String(request.body.username ?? "") },
        context: { challengeId: "c1" },
      }),
      verify: async () => ({ kind: "user", userId: "u1" }),
    });
    const listed = (await listPublicLoginMethods()).find(
      (m) => m.id === "passkey",
    );
    expect(listed).toMatchObject({ kind: "webauthn", placement: "inline" });

    const res = fakeResponse();
    await webauthnLoginOptions(
      fakeRequest({ body: { username: "bob" } }) as never,
      res as never,
      "passkey",
      null,
    );
    expect(res.body).toEqual({
      publicKey: { ...OPTIONS, user: "bob" },
      context: { challengeId: "c1" },
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuses options for a method that is not a passkey method", async () => {
    const { auth } = setup();
    auth.registerLoginMethod({
      id: "dir",
      labelKey: "dir.title",
      kind: "form",
      verify: async () => ({ kind: "user", userId: "u1" }),
    });
    const res = fakeResponse();
    await webauthnLoginOptions(
      fakeRequest() as never,
      res as never,
      "dir",
      null,
    );
    expect(res.statusCode).toBe(400);
  });

  it("lists each second factor with a checked prompt", () => {
    const { auth } = setup();
    auth.registerSecondFactor({
      id: "key",
      labelKey: "key.title",
      prompt: {
        kind: "code",
        field: "totp_code",
        length: 6,
        extra: 1,
      } as never,
      isEnrolled: async () => true,
      verify: async () => true,
    });
    registerSecondFactor({
      id: "other",
      pluginId: "x",
      labelKey: "x",
      isEnrolled: async () => true,
      verify: async () => true,
    });
    const listed = listPublicSecondFactors();
    expect(listed).toContainEqual({
      id: "key",
      pluginId: "keys",
      labelKey: "key.title",
      prompt: { kind: "code", field: "totp_code", length: 6 },
    });
    expect(listed).toContainEqual({
      id: "other",
      pluginId: "x",
      labelKey: "x",
    });
  });
});

describe("WebAuthn steps for a plugin's screens", () => {
  function registerAdd(auth: ReturnType<typeof setup>["auth"]) {
    const finish = vi.fn(async () => ({ added: true }));
    auth.registerWebAuthnCeremony!({
      id: "add-key",
      type: "create",
      options: async ({ extra }) => ({
        publicKey: { ...OPTIONS, name: String(extra.name ?? "") },
        context: { challengeId: "c9" },
      }),
      finish,
    });
    return finish;
  }

  const answer = { id: "cred", response: { clientDataJSON: "x" } };

  it("needs auth:provide in the manifest", () => {
    const { auth } = setup({
      id: "nope",
      capabilities: [],
    } as unknown as PluginManifest);
    expect(() => registerAdd(auth)).toThrow(/auth:provide/);
  });

  it("runs only under the plugin that registered it", async () => {
    registerAdd(setup().auth);
    await expect(
      startCeremony({
        pluginId: "snoop",
        ceremonyId: "add-key",
        userId: "u1",
        origin: "https://termix.test",
        extra: {},
      }),
    ).rejects.toBeInstanceOf(CeremonyError);
  });

  it("keeps the context on the server and hands the plugin only plain input", async () => {
    const finish = registerAdd(setup().auth);
    const start = await startCeremony({
      pluginId: "keys",
      ceremonyId: "add-key",
      userId: "u1",
      sessionId: "s1",
      origin: "https://termix.test",
      extra: { name: "Laptop", nested: { a: 1 }, fn: "x" },
    });
    expect(start).toMatchObject({
      type: "create",
      publicKey: { challenge: "abc", name: "Laptop" },
    });
    expect(start).not.toHaveProperty("context");
    const result = await finishCeremony({
      pluginId: "keys",
      ceremonyId: "add-key",
      ticket: start.ticket,
      userId: "u1",
      sessionId: "s1",
      response: answer,
    });
    expect(result).toEqual({ added: true });
    expect(finish).toHaveBeenCalledWith({
      userId: "u1",
      origin: "https://termix.test",
      extra: { name: "Laptop", fn: "x" },
      context: { challengeId: "c9" },
      response: answer,
    });
  });

  it("refuses a ticket for another person, session, plugin or a second use", async () => {
    registerAdd(setup().auth);
    const begin = () =>
      startCeremony({
        pluginId: "keys",
        ceremonyId: "add-key",
        userId: "u1",
        sessionId: "s1",
        origin: "https://termix.test",
        extra: {},
      });
    const finish = (ticket: string, over: Record<string, unknown> = {}) =>
      finishCeremony({
        pluginId: "keys",
        ceremonyId: "add-key",
        ticket,
        userId: "u1",
        sessionId: "s1",
        response: answer,
        ...over,
      });
    for (const over of [
      { userId: "u2" },
      { sessionId: "s2" },
      { pluginId: "snoop" },
    ]) {
      const { ticket } = await begin();
      await expect(finish(ticket, over)).rejects.toMatchObject({ status: 410 });
      // A refused try uses the ticket up too.
      await expect(finish(ticket)).rejects.toMatchObject({ status: 410 });
    }
    const { ticket } = await begin();
    await finish(ticket);
    await expect(finish(ticket)).rejects.toMatchObject({ status: 410 });
  });

  it("refuses an answer that is not a browser response", async () => {
    registerAdd(setup().auth);
    const { ticket } = await startCeremony({
      pluginId: "keys",
      ceremonyId: "add-key",
      userId: "u1",
      origin: "https://termix.test",
      extra: {},
    });
    await expect(
      finishCeremony({
        pluginId: "keys",
        ceremonyId: "add-key",
        ticket,
        userId: "u1",
        response: "nope",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("stops working once the plugin is turned off", async () => {
    const { auth, bag } = setup();
    registerAdd(auth);
    await bag.disposeAll();
    await expect(
      startCeremony({
        pluginId: "keys",
        ceremonyId: "add-key",
        userId: "u1",
        origin: "https://termix.test",
        extra: {},
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
