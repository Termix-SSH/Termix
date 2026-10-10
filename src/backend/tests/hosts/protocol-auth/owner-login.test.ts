import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  login: null as Record<string, unknown> | null,
  inherited: null as Record<string, unknown> | null,
}));

vi.mock("../../../database/db/index.js", () => ({
  getDb: () => null,
  getSqlite: () => null,
}));
vi.mock("../../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => Buffer.alloc(32) },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostProtocolAuthRepository: () => ({
    find: async () => state.login,
  }),
}));
vi.mock("../../../hosts/usable-credential.js", () => ({
  findUsableCredential: async (id: number) =>
    id === 9 ? { id, username: "folder-user", password: "folder-pass" } : null,
}));
vi.mock("../../../hosts/defaults/service.js", () => ({
  resolveForEditor: async () =>
    state.inherited ? { "core.auth": { value: state.inherited } } : {},
}));

const { resolveOwnerProtocolLogin } =
  await import("../../../hosts/protocol-auth/protocol-auth.js");

const RDP = { id: "rdp", pluginId: "remote-desktop", pluginName: "RD" };
const host = { id: 4, userId: "owner" };

describe("owner protocol login", () => {
  it("uses the folder credential when none is picked", async () => {
    state.login = { authType: "credential", credentialId: null };
    state.inherited = { authType: "credential", credentialId: 9 };
    const login = await resolveOwnerProtocolLogin(host, RDP as never);
    expect(login).toMatchObject({
      authType: "credential",
      username: "folder-user",
      password: "folder-pass",
    });
  });

  it("prefers the credential picked on the host", async () => {
    state.login = { authType: "credential", credentialId: 3 };
    state.inherited = { authType: "credential", credentialId: 9 };
    const login = await resolveOwnerProtocolLogin(host, RDP as never);
    expect(login.username).toBe("");
  });

  it("leaves a direct login alone", async () => {
    state.login = { authType: "direct", username: "me", password: "pw" };
    state.inherited = { authType: "credential", credentialId: 9 };
    const login = await resolveOwnerProtocolLogin(host, RDP as never);
    expect(login).toMatchObject({ username: "me", password: "pw" });
  });
});
