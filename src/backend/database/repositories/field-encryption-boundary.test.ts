import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { FieldEncryptionBoundary } from "./field-encryption-boundary.js";

describe("FieldEncryptionBoundary", () => {
  const userDataKey = crypto.randomBytes(32);

  it("encrypts sensitive host fields while leaving queryable metadata plaintext", () => {
    const host = {
      id: 42,
      userId: "user-1",
      name: "prod-db",
      ip: "10.0.0.5",
      username: "root",
      password: "secret",
      rdpPassword: "rdp-secret",
    };

    const encrypted = FieldEncryptionBoundary.encryptRecord(
      "ssh_data",
      host,
      userDataKey,
    );

    expect(encrypted.password).not.toBe("secret");
    expect(encrypted.rdpPassword).not.toBe("rdp-secret");
    expect(encrypted.ip).toBe("10.0.0.5");
    expect(encrypted.name).toBe("prod-db");

    const decrypted = FieldEncryptionBoundary.decryptRecord(
      "ssh_data",
      encrypted,
      userDataKey,
    );
    expect(decrypted).toMatchObject(host);
  });

  it("encrypts credential system secret fields that the legacy map did not cover", () => {
    const credential = {
      id: 7,
      userId: "user-1",
      name: "system credential",
      authType: "key",
      systemPassword: "system-password",
      systemKey: "system-key",
      systemKeyPassword: "system-key-password",
    };

    const encrypted = FieldEncryptionBoundary.encryptRecord(
      "ssh_credentials",
      credential,
      userDataKey,
    );

    expect(encrypted.systemPassword).not.toBe("system-password");
    expect(encrypted.systemKey).not.toBe("system-key");
    expect(encrypted.systemKeyPassword).not.toBe("system-key-password");
    expect(encrypted.name).toBe("system credential");

    expect(
      FieldEncryptionBoundary.decryptRecord(
        "ssh_credentials",
        encrypted,
        userDataKey,
      ),
    ).toMatchObject(credential);
  });

  it("keeps empty and non-string sensitive values unchanged", () => {
    const encrypted = FieldEncryptionBoundary.encryptRecord(
      "ssh_data",
      {
        id: 1,
        password: "",
        key: null,
      },
      userDataKey,
    );

    expect(encrypted.password).toBe("");
    expect(encrypted.key).toBeNull();
  });

  it("requires a stable record id instead of inventing a temporary encryption context", () => {
    expect(() =>
      FieldEncryptionBoundary.encryptRecord(
        "ssh_data",
        { password: "secret" },
        userDataKey,
      ),
    ).toThrow(/stable record id/);
  });

  it("classifies sensitive, plaintext, and unknown fields", () => {
    expect(FieldEncryptionBoundary.classifyField("ssh_data", "password")).toBe(
      "sensitive",
    );
    expect(FieldEncryptionBoundary.classifyField("ssh_data", "ip")).toBe(
      "plaintext",
    );
    expect(FieldEncryptionBoundary.classifyField("ssh_data", "newField")).toBe(
      "unknown",
    );
  });
});
