import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../database/db/index.js", () => ({
  getDb: () => null,
  getSqlite: () => null,
}));
vi.mock("../../../hosts/usable-credential.js", () => ({
  findUsableCredential: async (id: number, userId: string) =>
    id === 5 && userId === "importer" ? { id, username: "u" } : null,
}));

import {
  fromPortableLogin,
  keepUsableProtocolCredentials,
  mergeProtocolLogin,
  readProtocolAuthPayload,
  toPortableLogins,
} from "../../../hosts/protocol-auth/protocol-auth.js";
import {
  setHostProtocolSource,
  type DeclaredHostProtocol,
} from "../../../hosts/protocol-auth/registry.js";
import type { HostProtocolLogin } from "../../../database/repositories/host-protocol-auth-repository.js";

const SPICE: DeclaredHostProtocol = {
  id: "spice",
  credentialFields: [{ key: "display" }, { key: "ticket", secret: true }],
  pluginId: "spice-plugin",
  pluginName: "Spice",
};
const REMOTE_X: DeclaredHostProtocol = {
  id: "remote-x",
  credentialFields: [{ key: "domain" }],
  pluginId: "x-plugin",
  pluginName: "X",
};

const stored: HostProtocolLogin = {
  protocol: "spice",
  authType: "direct",
  credentialId: null,
  username: "viewer",
  password: "saved",
  fields: { display: "2" },
  secretFields: { ticket: "t-saved" },
};

beforeEach(() => setHostProtocolSource(() => [SPICE, REMOTE_X]));
afterEach(() => setHostProtocolSource(() => []));

describe("readProtocolAuthPayload", () => {
  it("reads protocolAuth for declared protocols only", () => {
    const patch = readProtocolAuthPayload({
      protocolAuth: {
        spice: { username: "a" },
        "remote-x": null,
        stranger: { username: "b" },
      },
    });
    expect(patch && Object.fromEntries(patch)).toEqual({
      spice: { username: "a" },
      "remote-x": null,
    });
  });

  it("reads the flat fields a 2.8 client sends, named after the protocol", () => {
    const patch = readProtocolAuthPayload({
      spiceUser: "viewer",
      spicePassword: "pw",
      spiceDisplay: "3",
      spiceAuthType: "direct",
      remoteXUser: "x-user",
      remoteXDomain: "CORP",
      remoteXCredentialId: 9,
    });
    expect(patch && Object.fromEntries(patch)).toEqual({
      spice: {
        authType: "direct",
        username: "viewer",
        password: "pw",
        fields: { display: "3" },
      },
      "remote-x": {
        credentialId: 9,
        username: "x-user",
        fields: { domain: "CORP" },
      },
    });
  });

  it("treats a 2.8 editor's null password as leaving it alone", () => {
    const patch = readProtocolAuthPayload({
      spiceAuthType: "direct",
      spiceUser: "viewer",
      spicePassword: null,
    });
    expect(patch?.get("spice")).toEqual({
      authType: "direct",
      username: "viewer",
    });
  });

  it("reads a 2.8 editor's all-null protocol as removed", () => {
    const patch = readProtocolAuthPayload({
      spiceAuthType: null,
      spiceUser: null,
      spicePassword: null,
      spiceCredentialId: null,
    });
    expect(patch?.get("spice")).toBeNull();
  });

  it("answers null when a write carries no logins", () => {
    expect(readProtocolAuthPayload({ name: "host" })).toBeNull();
  });
});

describe("mergeProtocolLogin", () => {
  it("keeps what the input leaves out, including secrets", () => {
    expect(mergeProtocolLogin("spice", SPICE, stored, {})).toEqual(stored);
  });

  it("keeps a saved password and secret for an empty value", () => {
    const next = mergeProtocolLogin("spice", SPICE, stored, {
      password: "",
      fields: { ticket: "", display: "" },
    });
    expect(next.password).toBe("saved");
    expect(next.secretFields).toEqual({ ticket: "t-saved" });
    // A plain field can be cleared.
    expect(next.fields).toEqual({});
  });

  it("drops the direct login and undeclared fields for a credential", () => {
    const next = mergeProtocolLogin("spice", SPICE, stored, {
      authType: "credential",
      credentialId: "12",
      fields: { unknown: "x" },
    });
    expect(next).toMatchObject({
      authType: "credential",
      credentialId: 12,
      username: null,
      password: null,
      fields: { display: "2" },
    });
  });

  it("starts a new login from the input", () => {
    expect(
      mergeProtocolLogin("spice", SPICE, null, {
        username: "new",
        password: "pw",
        fields: { ticket: "t" },
      }),
    ).toEqual({
      protocol: "spice",
      authType: "direct",
      credentialId: null,
      username: "new",
      password: "pw",
      fields: {},
      secretFields: { ticket: "t" },
    });
  });

  it("falls back to direct for an auth type it does not know", () => {
    expect(
      mergeProtocolLogin("spice", SPICE, null, { authType: "magic" }).authType,
    ).toBe("direct");
  });
});

describe("portable logins", () => {
  it("round-trips through an export, splitting fields by the declaration", () => {
    const portable = toPortableLogins([stored]);
    expect(portable.spice.fields).toEqual({ display: "2", ticket: "t-saved" });
    expect(fromPortableLogin("spice", portable.spice, null)).toEqual(stored);
  });

  it("keeps every field of an undeclared protocol secret", () => {
    expect(
      fromPortableLogin("gone", { fields: { display: "1" } }, null)
        ?.secretFields,
    ).toEqual({ display: "1" });
  });

  it("drops a credential link a user cannot use", async () => {
    const patch = await keepUsableProtocolCredentials(
      new Map([
        ["spice", { authType: "credential", credentialId: 5 }],
        ["remote-x", { authType: "credential", credentialId: 6 }],
      ]),
      "importer",
    );
    expect(patch.get("spice")).toEqual({
      authType: "credential",
      credentialId: 5,
    });
    expect(patch.get("remote-x")).toEqual({
      authType: "direct",
      credentialId: null,
    });
  });
});
