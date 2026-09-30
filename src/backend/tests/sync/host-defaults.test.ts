import { describe, expect, it, vi } from "vitest";

vi.mock("../../database/repositories/factory.js", () => ({}));
vi.mock("../../plugins/registry.js", () => ({ consume: () => undefined }));

const { exportDefaultValue, importDefaultValue, parseHostDefaultsSyncId } =
  await import("../../sync/host-defaults.js");

describe("host defaults over sync", () => {
  it("names a row by level, folder and key", () => {
    expect(parseHostDefaultsSyncId("u:core.sshPort")).toEqual({
      level: "user",
      folderSyncId: null,
      fullKey: "core.sshPort",
    });
    expect(parseHostDefaultsSyncId("f:abc-1:term.fontSize")).toEqual({
      level: "folder",
      folderSyncId: "abc-1",
      fullKey: "term.fontSize",
    });
    expect(parseHostDefaultsSyncId("x:core.sshPort")).toBeNull();
    expect(parseHostDefaultsSyncId("f:core.sshPort")).toBeNull();
  });

  it("sends a credential and jump hosts by syncId and maps them back", async () => {
    const out = {
      credential: async (id: number) => `cred-${id}`,
      host: async (id: number) => (id === 9 ? null : `host-${id}`),
    };
    const auth = await exportDefaultValue(
      "core",
      "auth",
      { authType: "credential", credentialId: 4 },
      out,
    );
    expect(auth).toEqual({
      authType: "credential",
      credentialSyncId: "cred-4",
    });
    const jumps = await exportDefaultValue(
      "core",
      "jumpHosts",
      [{ hostId: 1 }, { hostId: 9 }],
      out,
    );
    expect(jumps).toEqual([{ hostSyncId: "host-1" }]);

    const back = {
      credential: async (syncId: string) => Number(syncId.split("-")[1]) + 100,
      host: async (syncId: string) => Number(syncId.split("-")[1]) + 100,
    };
    expect(await importDefaultValue("core", "auth", auth, back)).toEqual({
      authType: "credential",
      credentialId: 104,
    });
    expect(await importDefaultValue("core", "jumpHosts", jumps, back)).toEqual([
      { hostId: 101 },
    ]);
  });

  it("passes other values through", async () => {
    expect(await exportDefaultValue("core", "sshPort", 22)).toBe(22);
    expect(
      await importDefaultValue("term", "fontSize", 16, {
        credential: async () => null,
        host: async () => null,
      }),
    ).toBe(16);
  });
});
