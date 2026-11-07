import { beforeEach, describe, expect, it, vi } from "vitest";

const setting = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("../../database/repositories/factory.js", () => ({
  getCurrentSettingValue: () => setting.value,
}));

import {
  assertSecretsAllowed,
  changedFields,
  credentialStorageAllowed,
  CredentialStorageError,
  storedSecretFields,
  stripSecrets,
} from "../../hosts/credential-storage.js";

beforeEach(() => {
  setting.value = null;
});

describe("credential storage switch", () => {
  it("is on until an admin turns it off", () => {
    expect(credentialStorageAllowed()).toBe(true);
    setting.value = "false";
    expect(credentialStorageAllowed()).toBe(false);
  });

  it("finds host secrets, including passwords in proxy chains", () => {
    expect(
      storedSecretFields("ssh_data", {
        name: "web",
        password: "",
        key: "PRIVATE",
        socks5ProxyChain: JSON.stringify([{ host: "a", password: "p" }]),
      }),
    ).toEqual(["key", "socks5ProxyChain"]);
    expect(storedSecretFields("ssh_data", { password: null })).toEqual([]);
  });

  it("finds protocol passwords and secret fields", () => {
    expect(
      storedSecretFields("protocol_auth", {
        password: "p",
        secretFields: { token: "t", empty: "" },
      }),
    ).toEqual(["password", "token"]);
  });

  it("refuses a new secret only while the switch is off", () => {
    const write = { privateKey: "PRIVATE", publicKey: "PUBLIC" };
    expect(() => assertSecretsAllowed("ssh_credentials", write)).not.toThrow();
    setting.value = "false";
    expect(() => assertSecretsAllowed("ssh_credentials", write)).toThrow(
      CredentialStorageError,
    );
    expect(() =>
      assertSecretsAllowed("ssh_credentials", { publicKey: "PUBLIC" }),
    ).not.toThrow();
    expect(() =>
      assertSecretsAllowed("ssh_credentials", { password: null }),
    ).not.toThrow();
  });

  it("lets an update through when its secret is the stored one", () => {
    setting.value = "false";
    const update = changedFields(
      { name: "new", password: "same" },
      { name: "old", password: "same" },
    );
    expect(update).toEqual({ name: "new" });
    expect(() => assertSecretsAllowed("ssh_data", update)).not.toThrow();
  });

  it("drops secrets from synced rows while off", () => {
    const row = { name: "web", password: "p", key: "k" };
    expect(stripSecrets("ssh_data", row)).toEqual(row);
    setting.value = "false";
    expect(stripSecrets("ssh_data", row)).toEqual({
      name: "web",
      password: null,
      key: null,
    });
  });
});
