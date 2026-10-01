import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  writes: [] as Array<[string, string]>,
  reloads: 0,
  renewers: [] as Array<{ pluginId: string; pluginName: string }>,
  challenges: new Map<string, string>(),
}));

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

vi.mock("../../tls/tls-service.js", () => ({
  getTlsStatus: async () => ({
    enabled: true,
    certificate: null,
    renewal: h.renewers[0] ?? null,
  }),
  writeTlsCertificate: async (cert: string, key: string) => {
    if (key === "wrong")
      throw new Error("The certificate and private key do not match");
    h.writes.push([cert, key]);
    return { subject: "CN=x" };
  },
  reloadTls: async () => {
    h.reloads++;
    return { applied: true, message: "ok" };
  },
  registerTlsRenewer: (renewer: { pluginId: string; pluginName: string }) => {
    h.renewers.push(renewer);
    return () => {
      h.renewers = h.renewers.filter((entry) => entry !== renewer);
    };
  },
}));

vi.mock("../../tls/acme-challenges.js", () => ({
  publishChallenge: (token: string, content: string) => {
    h.challenges.set(token, content);
    return () => h.challenges.delete(token);
  },
}));

const { createPluginSystem } = await import("../../plugins/ctx-system.js");
const { DisposableBag } = await import("../../plugins/disposables.js");
const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");

let audits: Array<{ action: string; success: boolean }>;

function create(capabilities = ["system:tls"]) {
  const bag = new DisposableBag("acme-ssl");
  const system = createPluginSystem({
    manifest: {
      id: "acme-ssl",
      name: "ACME Certificates",
      version: "1.0.0",
      capabilities,
    } as never,
    bag,
    audit: async (action, _details, outcome) => {
      audits.push({ action, success: outcome.success });
    },
  });
  return { system, bag };
}

beforeEach(() => {
  h.granted = new Set(["system:tls"]);
  h.writes = [];
  h.reloads = 0;
  h.renewers = [];
  h.challenges = new Map();
  audits = [];
});

describe("ctx.system", () => {
  it("writes, reloads and audits every call", async () => {
    const { system } = create();
    await system.writeTlsCertificate("CERT", "KEY");
    await system.reloadTls();
    expect(h.writes).toEqual([["CERT", "KEY"]]);
    expect(h.reloads).toBe(1);
    expect(audits).toEqual([
      { action: "tls_write", success: true },
      { action: "tls_reload", success: true },
    ]);
  });

  it("passes a rejected pair back to the plugin and audits the failure", async () => {
    const { system } = create();
    await expect(system.writeTlsCertificate("CERT", "wrong")).rejects.toThrow(
      /do not match/,
    );
    expect(audits).toEqual([{ action: "tls_write", success: false }]);
  });

  it("refuses without system:tls, declared or granted", async () => {
    await expect(create([]).system.reloadTls()).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
    h.granted.clear();
    await expect(create().system.tlsStatus()).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
    expect(h.reloads).toBe(0);
    expect(audits.every((entry) => !entry.success)).toBe(true);
  });

  it("drops the renewer and challenges when the plugin is disabled", async () => {
    const { system, bag } = create();
    await system.registerTlsRenewer();
    await system.publishHttpChallenge("tok", "tok.key");
    expect((await system.tlsStatus()).renewal?.pluginId).toBe("acme-ssl");
    expect(h.challenges.get("tok")).toBe("tok.key");

    await bag.disposeAll();
    expect(h.renewers).toEqual([]);
    expect(h.challenges.size).toBe(0);
  });

  it("lets the plugin withdraw a challenge itself, once", async () => {
    const { system, bag } = create();
    const remove = await system.publishHttpChallenge("tok", "tok.key");
    remove();
    remove();
    expect(h.challenges.size).toBe(0);
    expect(bag.size).toBe(0);
  });
});
