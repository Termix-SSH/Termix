/**
 * No ctx method hands a plugin plaintext credential material unless the
 * plugin holds credentials:read. Every return value is scanned for secret
 * keys, nested ones included, so a new field on the host row that carries a
 * secret shows up here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "s3cret-value";

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  actor: "user-1" as string | undefined,
  connected: [] as unknown[],
}));

function secretHost(id: number): Record<string, unknown> {
  return {
    id,
    userId: "user-1",
    name: "box",
    ip: "10.0.0.1",
    port: 22,
    username: "root",
    authType: "password",
    tags: null,
    folder: null,
    password: "s3cret-value",
    key: "s3cret-value",
    keyPassword: "s3cret-value",
    sudoPassword: "s3cret-value",
    socks5Password: "s3cret-value",
    rdpPassword: "s3cret-value",
    vncPassword: "s3cret-value",
    telnetPassword: "s3cret-value",
    autostartPassword: "s3cret-value",
    autostartKey: "s3cret-value",
    autostartKeyPassword: "s3cret-value",
    terminalConfig: { sudoPassword: "s3cret-value", fontSize: 14 },
    socks5ProxyChain: [{ host: "p", password: "s3cret-value" }],
  };
}

vi.mock("../../../plugins/permissions.js", async () => {
  const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");
  const granted = (capability: string, declared: readonly string[]) =>
    declared.includes(capability) && h.granted.has(capability);
  return {
    assertCapability: async (
      pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => {
      if (!granted(capability, declared)) {
        throw new PluginCapabilityError(pluginId, capability);
      }
    },
    hasCapability: async (
      _pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => granted(capability, declared),
    hasCachedCapability: (
      _pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => granted(capability, declared),
    warmPluginGrants: () => {},
    capabilityRefused: (pluginId: string, capability: string) =>
      new PluginCapabilityError(pluginId, capability),
  };
});
vi.mock("../../../plugins/actor.js", () => ({
  getActor: () => h.actor,
  getActorSessionId: () => undefined,
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async () => ({ hasAccess: true, isOwner: true }),
      hasPermission: async () => true,
    }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostRepository: () => ({
    createEncryptedForUser: async () => secretHost(1),
    updateEncryptedForUser: async () => secretHost(1),
    listDecryptedByUserId: async () => [secretHost(1), secretHost(2)],
  }),
  createCurrentHostResolutionRepository: () => ({
    findHostsByUserId: async () => [secretHost(1)],
    listHostRowsForAccessList: async () => [secretHost(2)],
    findHostOwnerId: async () => "user-1",
    findHostById: async (id: number) => secretHost(id),
  }),
  createCurrentRoleRepository: () => ({ listUserRoleIds: async () => [] }),
  createCurrentRbacAccessRepository: () => ({
    listVisibleHostAccessEntries: async () => [],
  }),
}));
vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  applyPluginHostImportSettings: async () => {},
}));
vi.mock("../../../hosts/host-resolver.js", () => ({
  resolveHostById: async (id: number) => secretHost(id),
  resolveHostBySyncId: async () => secretHost(9),
}));
vi.mock("../../../hosts/connect/connect-host.js", () => ({
  connectHost: async (target: unknown) => {
    h.connected.push(target);
    return {
      client: { once: () => {} },
      jumpClient: null,
      host: typeof target === "number" ? secretHost(target) : target,
      dispose: () => {},
    };
  },
  resolveConnectHost: async (target: unknown) =>
    typeof target === "number" ? secretHost(target) : target,
}));

const { createPluginHosts, redactHostSecrets, HOST_SECRET_FIELDS } =
  await import("../../../plugins/ctx-hosts.js");
const { createPluginSsh } = await import("../../../plugins/ctx-ssh-auth.js");
const { DisposableBag } = await import("../../../plugins/disposables.js");

function manifest(capabilities: string[]) {
  return {
    id: "fixture",
    name: "Fixture",
    version: "1.0.0",
    capabilities,
  } as never;
}

/** Every path in `value` that holds the secret. */
function leaks(value: unknown, path = "$"): string[] {
  if (value === SECRET) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => leaks(entry, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      leaks(entry, `${path}.${key}`),
    );
  }
  return [];
}

const audit = vi.fn(async () => {});

beforeEach(() => {
  h.actor = "user-1";
  h.granted = new Set();
  h.connected = [];
  audit.mockClear();
});

describe("redactHostSecrets", () => {
  it("removes every secret field, nested ones too", () => {
    const redacted = redactHostSecrets(secretHost(1));
    expect(leaks(redacted)).toEqual([]);
    for (const field of HOST_SECRET_FIELDS) {
      expect(redacted).not.toHaveProperty(field);
    }
    expect(redacted).toMatchObject({ id: 1, ip: "10.0.0.1" });
    expect(redacted.terminalConfig).toEqual({ fontSize: 14 });
  });
});

describe("ctx.hosts never returns secrets", () => {
  const all = ["hosts:read", "hosts:write"];

  it("list, get, create, update and listOwned", async () => {
    h.granted = new Set(all);
    const hosts = createPluginHosts({ manifest: manifest(all), audit });
    const results = {
      list: await hosts.list(),
      get: await hosts.get(1),
      create: await hosts.create({
        name: "n",
        ip: "i",
        port: 22,
        username: "u",
        authType: "password",
      }),
      update: await hosts.update(1, { name: "m" }),
      listOwned: await hosts.listOwned(),
    };
    expect(leaks(results)).toEqual([]);
  });

  it("audits listOwned, the widest read it has", async () => {
    h.granted = new Set(all);
    const hosts = createPluginHosts({ manifest: manifest(all), audit });
    await hosts.listOwned();
    expect(audit).toHaveBeenCalledWith("hosts_list_owned", "2 host(s)", {
      success: true,
    });
  });
});

describe("ctx.ssh hands secrets only to credentials:read", () => {
  const connectPair = ["ssh:connect", "credentials:use"];

  it("connect() returns the host without its secrets", async () => {
    h.granted = new Set(connectPair);
    const ssh = createPluginSsh({
      manifest: manifest(connectPair),
      bag: new DisposableBag("fixture"),
      audit,
    });
    const connection = await ssh.connect(1);
    expect(leaks(connection.host)).toEqual([]);
  });

  it("resolveHost() redacts without credentials:read", async () => {
    h.granted = new Set(connectPair);
    const ssh = createPluginSsh({
      manifest: manifest(connectPair),
      bag: new DisposableBag("fixture"),
      audit,
    });
    expect(leaks(await ssh.resolveHost(1))).toEqual([]);
  });

  it("resolveHost() gives the full host with credentials:read, and audits it", async () => {
    const withRead = [...connectPair, "credentials:read"];
    h.granted = new Set(withRead);
    const ssh = createPluginSsh({
      manifest: manifest(withRead),
      bag: new DisposableBag("fixture"),
      audit,
    });
    expect(leaks(await ssh.resolveHost(1)).length).toBeGreaterThan(0);
    expect(audit).toHaveBeenCalledWith("credentials_read", "host 1", {
      success: true,
    });
  });

  it("a redacted host handed back still connects with the real secrets", async () => {
    h.granted = new Set(connectPair);
    const ssh = createPluginSsh({
      manifest: manifest(connectPair),
      bag: new DisposableBag("fixture"),
      audit,
    });
    const redacted = await ssh.resolveHost(1);
    await ssh.connect(redacted!);
    expect(h.connected[0]).toMatchObject({ password: SECRET });
  });
});
