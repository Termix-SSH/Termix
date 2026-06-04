import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { FieldCrypto } from "./field-crypto.js";

const masterKey = crypto.randomBytes(32);

describe("FieldCrypto.encryptField / decryptField", () => {
  it("round-trips a plaintext value", () => {
    const encrypted = FieldCrypto.encryptField(
      "s3cr3t-password",
      masterKey,
      "record-1",
      "password",
    );
    const decrypted = FieldCrypto.decryptField(
      encrypted,
      masterKey,
      "record-1",
      "password",
    );
    expect(decrypted).toBe("s3cr3t-password");
  });

  it("returns empty string for empty input", () => {
    expect(FieldCrypto.encryptField("", masterKey, "r", "f")).toBe("");
    expect(FieldCrypto.decryptField("", masterKey, "r", "f")).toBe("");
  });

  it("produces different ciphertext each time (random IV + salt)", () => {
    const a = FieldCrypto.encryptField("same", masterKey, "r", "f");
    const b = FieldCrypto.encryptField("same", masterKey, "r", "f");
    expect(a).not.toBe(b);
    expect(FieldCrypto.decryptField(a, masterKey, "r", "f")).toBe("same");
    expect(FieldCrypto.decryptField(b, masterKey, "r", "f")).toBe("same");
  });

  it("fails to decrypt with the wrong master key", () => {
    const encrypted = FieldCrypto.encryptField("value", masterKey, "r", "f");
    const wrongKey = crypto.randomBytes(32);
    expect(() =>
      FieldCrypto.decryptField(encrypted, wrongKey, "r", "f"),
    ).toThrow();
  });

  it("fails to decrypt when the field name context differs", () => {
    const encrypted = FieldCrypto.encryptField(
      "value",
      masterKey,
      "r",
      "password",
    );
    expect(() =>
      FieldCrypto.decryptField(encrypted, masterKey, "r", "key"),
    ).toThrow();
  });

  it("detects tampering with the ciphertext (GCM auth tag)", () => {
    const encrypted = FieldCrypto.encryptField("value", masterKey, "r", "f");
    const parsed = JSON.parse(encrypted);
    // Flip a hex char in the encrypted data.
    parsed.data = (parsed.data[0] === "a" ? "b" : "a") + parsed.data.slice(1);
    const tampered = JSON.stringify(parsed);
    expect(() =>
      FieldCrypto.decryptField(tampered, masterKey, "r", "f"),
    ).toThrow();
  });

  it("throws when the encrypted payload is missing recordId context", () => {
    const encrypted = FieldCrypto.encryptField("value", masterKey, "r", "f");
    const parsed = JSON.parse(encrypted);
    delete parsed.recordId;
    expect(() =>
      FieldCrypto.decryptField(JSON.stringify(parsed), masterKey, "r", "f"),
    ).toThrow(/recordId/);
  });
});

describe("FieldCrypto.shouldEncryptField", () => {
  it("identifies encrypted fields per table", () => {
    expect(FieldCrypto.shouldEncryptField("users", "passwordHash")).toBe(true);
    expect(FieldCrypto.shouldEncryptField("ssh_data", "password")).toBe(true);
    expect(
      FieldCrypto.shouldEncryptField("ssh_credentials", "privateKey"),
    ).toBe(true);
  });

  it("returns false for non-encrypted fields and unknown tables", () => {
    expect(FieldCrypto.shouldEncryptField("users", "username")).toBe(false);
    expect(FieldCrypto.shouldEncryptField("unknown_table", "password")).toBe(
      false,
    );
  });
});
