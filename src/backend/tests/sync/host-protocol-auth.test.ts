/**
 * A host's plugin protocol logins over sync: out with the credential named
 * by syncId, back in with it translated to the local id.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  logins: [] as Array<Record<string, unknown>>,
  replaced: null as null | { ownerId: string; hostId: number; logins: unknown },
}));

vi.mock(
  "../../hosts/protocol-auth/protocol-auth.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../hosts/protocol-auth/protocol-auth.js")
      >();
    return {
      ...actual,
      listProtocolLogins: async () => state.logins,
      replaceProtocolLogins: async (
        ownerId: string,
        hostId: number,
        logins: unknown,
      ) => {
        state.replaced = { ownerId, hostId, logins };
      },
    };
  },
);
vi.mock("../../database/db/index.js", () => ({
  getDb: () => null,
  getSqlite: () => null,
}));

import {
  exportProtocolLogins,
  importProtocolLogins,
} from "../../sync/host-protocol-auth.js";
import { setHostProtocolSource } from "../../hosts/protocol-auth/registry.js";

beforeEach(() => {
  state.replaced = null;
  state.logins = [
    {
      protocol: "spice",
      authType: "credential",
      credentialId: 4,
      username: null,
      password: null,
      fields: { display: "2" },
      secretFields: { ticket: "t" },
    },
  ];
  setHostProtocolSource(() => [
    {
      id: "spice",
      credentialFields: [{ key: "display" }, { key: "ticket", secret: true }],
      pluginId: "p",
      pluginName: "P",
    },
  ]);
});

describe("host protocol logins over sync", () => {
  it("sends each login with its credential as a syncId", async () => {
    const wire = await exportProtocolLogins(1, "owner", async (type, id) =>
      type === "sshCredentials" && id === 4 ? "cred-sync-4" : null,
    );
    expect(wire).toEqual({
      spice: {
        authType: "credential",
        username: null,
        password: null,
        fields: { display: "2", ticket: "t" },
        credentialSyncId: "cred-sync-4",
      },
    });
  });

  it("writes what arrived with the credential's local id", async () => {
    await importProtocolLogins(
      9,
      "owner",
      {
        spice: {
          authType: "credential",
          fields: { display: "3", ticket: "t2" },
          credentialSyncId: "cred-sync-4",
        },
      },
      async (type, syncId) =>
        type === "sshCredentials" && syncId === "cred-sync-4" ? 40 : null,
    );
    expect(state.replaced).toEqual({
      ownerId: "owner",
      hostId: 9,
      logins: [
        {
          protocol: "spice",
          authType: "credential",
          credentialId: 40,
          username: null,
          password: null,
          fields: { display: "3" },
          secretFields: { ticket: "t2" },
        },
      ],
    });
  });

  it("keeps the current credential while its target has not arrived", async () => {
    await importProtocolLogins(
      9,
      "owner",
      { spice: { authType: "credential", credentialSyncId: "later" } },
      async () => null,
    );
    expect(
      (state.replaced?.logins as Array<{ credentialId: number }>)[0]
        .credentialId,
    ).toBe(4);
  });

  it("leaves the logins alone for a peer that sends none", async () => {
    await importProtocolLogins(9, "owner", undefined, async () => null);
    expect(state.replaced).toBeNull();
  });
});
