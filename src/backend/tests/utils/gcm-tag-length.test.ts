import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FieldCrypto } from "../../utils/field-crypto.js";

const masterKey = crypto.randomBytes(32);

describe("AES-GCM tag length", () => {
  it("refuses a field whose tag was cut short", () => {
    const encrypted = JSON.parse(
      FieldCrypto.encryptField("secret", masterKey, "record-1", "password"),
    ) as { tag: string };
    for (const bytes of [4, 8, 12]) {
      const short = JSON.stringify({
        ...encrypted,
        tag: encrypted.tag.slice(0, bytes * 2),
      });
      expect(() =>
        FieldCrypto.decryptField(short, masterKey, "record-1", "password"),
      ).toThrow();
    }
  });

  it("still opens a full tag", () => {
    const encrypted = FieldCrypto.encryptField("secret", masterKey, "r", "f");
    expect(FieldCrypto.decryptField(encrypted, masterKey, "r", "f")).toBe(
      "secret",
    );
  });

  it("sets the tag length on every GCM decipher in core", () => {
    const dir = path.resolve("src/backend/utils");
    const files = [
      "auth-manager.ts",
      "crypto-migration/dek-migration.ts",
      "field-crypto.ts",
      "system-secret-crypto.ts",
      "user-keys.ts",
      "database-file-encryption.ts",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      const calls = source
        .split("createDecipheriv(")
        .slice(1)
        .map((rest) => rest.slice(0, rest.indexOf(";")));
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, file).toContain("authTagLength: 16");
      }
    }
  });
});
