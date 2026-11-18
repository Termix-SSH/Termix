import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { FieldCrypto } from "../../utils/field-crypto.js";
import { LazyFieldEncryption } from "../../utils/lazy-field-encryption.js";

const kek = crypto.randomBytes(32);
const other = crypto.randomBytes(32);

describe("isPlaintextField", () => {
  it("treats only full encrypted records as encrypted", () => {
    const sealed = FieldCrypto.encryptField("pw", kek, "1", "password");
    expect(LazyFieldEncryption.isPlaintextField(sealed)).toBe(false);
    expect(LazyFieldEncryption.isPlaintextField("hunter2")).toBe(true);
    expect(LazyFieldEncryption.isPlaintextField('{"data":"x"}')).toBe(true);
    expect(LazyFieldEncryption.isPlaintextField("")).toBe(false);
  });
});

describe("safeGetFieldValue", () => {
  it("decrypts, passes plaintext through and handles empty values", () => {
    const sealed = FieldCrypto.encryptField("pw", kek, "1", "password");
    expect(
      LazyFieldEncryption.safeGetFieldValue(sealed, kek, "1", "password"),
    ).toBe("pw");
    expect(
      LazyFieldEncryption.safeGetFieldValue("plain", kek, "1", "password"),
    ).toBe("plain");
    expect(
      LazyFieldEncryption.safeGetFieldValue("", kek, "1", "password"),
    ).toBe("");
  });

  it("reads values sealed under the old snake_case field name", () => {
    const sealed = FieldCrypto.encryptField("k", kek, "2", "key_password");
    expect(
      LazyFieldEncryption.safeGetFieldValue(sealed, kek, "2", "keyPassword"),
    ).toBe("k");
  });

  it("gives an empty secret instead of failing when the key is wrong", () => {
    const sealed = FieldCrypto.encryptField("pw", other, "1", "password");
    expect(
      LazyFieldEncryption.safeGetFieldValue(sealed, kek, "1", "password"),
    ).toBe("");
  });

  it("throws for a non secret field it can't open", () => {
    const sealed = FieldCrypto.encryptField("x", other, "1", "notes");
    expect(() =>
      LazyFieldEncryption.safeGetFieldValue(sealed, kek, "1", "notes"),
    ).toThrow();
  });
});

describe("migrateFieldToEncrypted", () => {
  it("encrypts plaintext and leaves current values alone", () => {
    const fresh = LazyFieldEncryption.migrateFieldToEncrypted(
      "pw",
      kek,
      "1",
      "password",
    );
    expect(fresh.wasPlaintext).toBe(true);
    expect(
      FieldCrypto.decryptField(fresh.encrypted, kek, "1", "password"),
    ).toBe("pw");
    const again = LazyFieldEncryption.migrateFieldToEncrypted(
      fresh.encrypted,
      kek,
      "1",
      "password",
    );
    expect(again).toEqual({
      encrypted: fresh.encrypted,
      wasPlaintext: false,
      wasLegacyEncryption: false,
    });
    expect(
      LazyFieldEncryption.migrateFieldToEncrypted("", kek, "1", "password"),
    ).toEqual({
      encrypted: "",
      wasPlaintext: false,
      wasLegacyEncryption: false,
    });
  });

  it("reseals legacy field names under the new name", () => {
    const legacy = FieldCrypto.encryptField("s", kek, "3", "sudo_password");
    const result = LazyFieldEncryption.migrateFieldToEncrypted(
      legacy,
      kek,
      "3",
      "sudoPassword",
    );
    expect(result.wasLegacyEncryption).toBe(true);
    expect(
      FieldCrypto.decryptField(result.encrypted, kek, "3", "sudoPassword"),
    ).toBe("s");
  });

  it("keeps a value it can't open as it is", () => {
    const foreign = FieldCrypto.encryptField("s", other, "3", "sudoPassword");
    expect(
      LazyFieldEncryption.migrateFieldToEncrypted(
        foreign,
        kek,
        "3",
        "sudoPassword",
      ),
    ).toEqual({
      encrypted: foreign,
      wasPlaintext: false,
      wasLegacyEncryption: false,
    });
  });
});

describe("records and tables", () => {
  it("migrates each plaintext secret column of a record", () => {
    const { updatedRecord, migratedFields, needsUpdate } =
      LazyFieldEncryption.migrateRecordSensitiveFields(
        { id: 1, password: "pw", key_password: "kp", name: "web" },
        LazyFieldEncryption.getSensitiveFieldsForTable("ssh_data"),
        kek,
        "1",
      );
    expect(needsUpdate).toBe(true);
    expect(migratedFields).toEqual(["password", "keyPassword"]);
    expect(updatedRecord.name).toBe("web");
    expect(
      FieldCrypto.decryptField(
        updatedRecord.key_password as string,
        kek,
        "1",
        "keyPassword",
      ),
    ).toBe("kp");
  });

  it("knows which columns hold secrets", () => {
    expect(
      LazyFieldEncryption.getSensitiveFieldsForTable("ssh_credentials"),
    ).toContain("privateKey");
    expect(LazyFieldEncryption.getSensitiveFieldsForTable("users")).toEqual([]);
    expect(LazyFieldEncryption.propertyToColumn("privateKey")).toBe(
      "private_key",
    );
    expect(LazyFieldEncryption.propertyToColumn("password")).toBe("password");
  });

  it("says which fields still need migrating", () => {
    const current = FieldCrypto.encryptField("x", kek, "1", "password");
    const legacy = FieldCrypto.encryptField("x", kek, "1", "private_key");
    expect(
      LazyFieldEncryption.fieldNeedsMigration("plain", kek, "1", "password"),
    ).toBe(true);
    expect(
      LazyFieldEncryption.fieldNeedsMigration(current, kek, "1", "password"),
    ).toBe(false);
    expect(
      LazyFieldEncryption.fieldNeedsMigration(legacy, kek, "1", "privateKey"),
    ).toBe(true);
    expect(
      LazyFieldEncryption.fieldNeedsMigration(current, other, "1", "password"),
    ).toBe(false);
    expect(
      LazyFieldEncryption.fieldNeedsMigration(
        current,
        other,
        "1",
        "privateKey",
      ),
    ).toBe(false);
    expect(LazyFieldEncryption.fieldNeedsMigration("", kek, "1", "x")).toBe(
      false,
    );
  });

  it("lists a user's hosts and credentials that need migrating", async () => {
    const sealed = FieldCrypto.encryptField("x", kek, "5", "password");
    const store = {
      listHostRecords: () => [
        { id: 4, password: "plain", sudo_password: "plain2" },
        { id: 5, password: sealed },
      ],
      listCredentialRecords: () => [{ id: 9, private_key: "plain-key" }],
    };
    const result = await LazyFieldEncryption.checkUserNeedsMigration(
      "u1",
      kek,
      store as never,
    );
    expect(result).toEqual({
      needsMigration: true,
      plaintextFields: [
        {
          table: "ssh_data",
          recordId: "4",
          fields: ["password", "sudoPassword"],
        },
        { table: "ssh_credentials", recordId: "9", fields: ["privateKey"] },
      ],
    });
  });

  it("reports no migration when the store fails", async () => {
    const store = {
      listHostRecords: () => {
        throw new Error("db down");
      },
      listCredentialRecords: () => [],
    };
    expect(
      await LazyFieldEncryption.checkUserNeedsMigration(
        "u1",
        kek,
        store as never,
      ),
    ).toEqual({ needsMigration: false, plaintextFields: [] });
  });
});
