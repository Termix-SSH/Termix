import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hosts: [] as Record<string, unknown>[],
  credentials: [] as Record<string, unknown>[],
  resolve: vi.fn(),
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostsByUserId: async () => state.hosts,
    findHostByIdForUser: async (id: number) =>
      state.hosts.find((host) => host.id === id) ?? null,
  }),
  createCurrentCredentialRepository: () => ({
    listDecryptedByUserId: async () => state.credentials,
  }),
}));
vi.mock("../../../database/routes/host-normalizers.js", () => ({
  hostTerminalExport: () => ({ terminalConfig: null, sshOptions: null }),
}));
vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  loadHostPluginSettings: async () => new Map(),
}));
vi.mock("../../../hosts/protocol-auth/protocol-auth.js", () => ({
  listProtocolLogins: async () => [],
  toPortableLogins: () => ({
    rdp: {
      authType: "credential",
      credentialId: 4,
      username: "bob",
      password: "rdp-secret",
      fields: { domain: "corp", token: "t" },
    },
  }),
}));
vi.mock("../../../hosts/protocol-auth/registry.js", () => ({
  findHostProtocol: () => ({
    credentialFields: [{ key: "token", secret: true }, { key: "domain" }],
  }),
}));
vi.mock("../../../hosts/resolve-host-credentials.js", () => ({
  resolveHostCredentials: state.resolve,
}));

import { exportAllHosts } from "../../../hosts/import/host-export.js";

const sshHost = {
  id: 1,
  connectionType: "ssh",
  name: "web",
  ip: "192.0.2.1",
  port: 22,
  username: "alice",
  password: "pw",
  key: "KEY",
  keyPassword: "kp",
  sudoPassword: "sp",
  socks5Password: "s5",
  authType: "credential",
  credentialId: 7,
  folder: "Prod",
  tags: "a,b",
  jumpHosts: JSON.stringify([{ hostId: 2 }]),
  forceKeyboardInteractive: "true",
};

beforeEach(() => {
  state.hosts = [{ ...sshHost }];
  state.credentials = [
    { id: 7, name: "deploy", authType: "key", username: "alice", tags: "x" },
  ];
  state.resolve.mockReset().mockImplementation(async (host) => ({
    ...host,
    password: "resolved-pw",
    key: "RESOLVED-KEY",
  }));
});

describe("exportAllHosts", () => {
  it("includes decrypted secrets without share mode", async () => {
    const result = await exportAllHosts("u1", false);
    expect(result.credentials).toBeUndefined();
    expect(result.hosts[0]).toMatchObject({
      exportId: 1,
      password: "resolved-pw",
      key: "RESOLVED-KEY",
      sudoPassword: "sp",
      credentialId: 7,
      tags: ["a", "b"],
      jumpHosts: [{ hostId: 2 }],
      forceKeyboardInteractive: true,
    });
    expect(state.resolve).toHaveBeenCalled();
  });

  it("leaves out every secret and credential id in share mode", async () => {
    const result = await exportAllHosts("u1", true);
    const [host] = result.hosts;
    expect(state.resolve).not.toHaveBeenCalled();
    expect(host).toMatchObject({
      password: null,
      key: null,
      keyPassword: null,
      sudoPassword: null,
      socks5Password: null,
      credentialAlias: "deploy",
    });
    expect(host).not.toHaveProperty("credentialId");
    expect(result.credentials).toEqual([
      expect.objectContaining({ alias: "deploy", authType: "key" }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/rdp-secret|"t"/);
    expect(host.protocolAuth).toMatchObject({
      rdp: {
        authType: "direct",
        credentialId: null,
        password: null,
        fields: { domain: "corp" },
      },
    });
    expect(result.version).toBe("1");
  });

  it("exports a remote desktop host without SSH fields", async () => {
    state.hosts = [{ ...sshHost, connectionType: "rdp" }];
    const result = await exportAllHosts("u1", false);
    expect(result.hosts[0]).not.toHaveProperty("authType");
    expect(result.hosts[0]).toHaveProperty("protocolAuth");
  });
});

describe("exportAllHosts with hostIds", () => {
  it("exports only the asked hosts the user owns", async () => {
    state.hosts = [
      { ...sshHost, id: 1 },
      { ...sshHost, id: 2 },
    ];
    const result = await exportAllHosts("u1", false, [2, 99]);
    expect(result.hosts.map((host) => host.exportId)).toEqual([2]);
  });

  it("returns nothing for an id the user does not own", async () => {
    const result = await exportAllHosts("u1", false, [99]);
    expect(result.hosts).toEqual([]);
  });
});
