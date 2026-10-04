/**
 * A host's plugin protocol logins over sync: out with the credential named
 * by syncId, back in with it translated to the local id.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  logins: [] as Array<Record<string, unknown>>,
  replaced: null as null | { ownerId: string; hostId: number; logins: unknown },
  rows: [] as Array<{ protocol: string }>,
  recipient: new Map<string, Record<string, unknown> | Error>(),
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
      resolveRecipientProtocolLogin: async (
        _host: unknown,
        _userId: string,
        declared: { id: string },
      ) => {
        const login = state.recipient.get(declared.id);
        if (login instanceof Error) throw login;
        return login;
      },
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
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostProtocolAuthRepository: () => ({
    listRowsForHost: async () => state.rows,
  }),
}));
vi.mock("../../database/db/index.js", () => ({
  getDb: () => null,
  getSqlite: () => null,
}));

import {
  exportProtocolLogins,
  exportSharedProtocolLogins,
  importProtocolLogins,
} from "../../sync/host-protocol-auth.js";
import { setHostProtocolSource } from "../../hosts/protocol-auth/registry.js";

beforeEach(() => {
  state.replaced = null;
  state.rows = [];
  state.recipient.clear();
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

describe("shared host protocol logins over sync", () => {
  it("sends what the recipient may use as direct logins", async () => {
    state.rows = [{ protocol: "spice" }, { protocol: "unknown" }];
    state.recipient.set("spice", {
      authType: "credential",
      username: "alice",
      password: "pw",
      fields: { display: "2", ticket: "" },
    });
    expect(
      await exportSharedProtocolLogins({ id: 1, userId: "owner" }, "viewer"),
    ).toEqual({
      spice: {
        authType: "direct",
        username: "alice",
        password: "pw",
        fields: { display: "2" },
        credentialSyncId: null,
      },
    });
  });

  it("keeps a none login and skips one that fails", async () => {
    setHostProtocolSource(() => [
      { id: "spice", credentialFields: [], pluginId: "p", pluginName: "P" },
      { id: "vnc", credentialFields: [], pluginId: "p", pluginName: "P" },
    ]);
    state.rows = [{ protocol: "spice" }, { protocol: "vnc" }];
    state.recipient.set("spice", {
      authType: "none",
      username: "",
      password: "",
      fields: {},
    });
    state.recipient.set("vnc", new Error("locked"));
    expect(
      await exportSharedProtocolLogins({ id: 1, userId: "owner" }, "viewer"),
    ).toEqual({
      spice: {
        authType: "none",
        username: null,
        password: null,
        fields: {},
        credentialSyncId: null,
      },
    });
  });
});
