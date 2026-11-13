import { beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

const keys = vi.hoisted(() => ({ dek: Buffer.alloc(32, 4) }));

vi.mock("../../database/db/index.js", () => ({
  db: {},
  getDb: () => ({}),
}));

vi.mock("../../utils/user-keys.js", () => ({
  UserKeyManager: {
    getInstance: () => ({
      tryGetUserDEK: (id: string) => (id === "u1" ? keys.dek : null),
      getUserDEK: (id: string) => {
        if (id !== "u1") throw new Error("locked");
        return keys.dek;
      },
    }),
  },
}));

const { DataCrypto } = await import("../../utils/data-crypto.js");
const { FieldCrypto } = await import("../../utils/field-crypto.js");

beforeAll(() => DataCrypto.initialize());

describe("records", () => {
  it("encrypts only the secret fields and opens them again", () => {
    const record = { id: 7, name: "web", password: "pw", key: "KEY" };
    const sealed = DataCrypto.encryptRecord("ssh_data", record, "u1", keys.dek);
    expect(sealed.name).toBe("web");
    expect(sealed.password).not.toBe("pw");
    expect(sealed.key).not.toBe("KEY");
    expect(
      DataCrypto.decryptRecord("ssh_data", sealed, "u1", keys.dek),
    ).toEqual(record);
    expect(
      DataCrypto.decryptRecords("ssh_data", [sealed, sealed], "u1", keys.dek),
    ).toEqual([record, record]);
    expect(
      DataCrypto.decryptRecord("ssh_data", null as never, "u1", keys.dek),
    ).toBeNull();
    expect(
      DataCrypto.decryptRecords("ssh_data", "x" as never, "u1", keys.dek),
    ).toBe("x");
  });

  it("works through the user's unlocked key and refuses a locked user", () => {
    const sealed = DataCrypto.encryptRecordForUser(
      "ssh_data",
      { id: 1, password: "pw" },
      "u1",
    );
    expect(DataCrypto.decryptRecordForUser("ssh_data", sealed, "u1")).toEqual({
      id: 1,
      password: "pw",
    });
    expect(
      DataCrypto.decryptRecordsForUser("ssh_data", [sealed], "u1"),
    ).toHaveLength(1);
    expect(() =>
      DataCrypto.encryptRecordForUser("ssh_data", { id: 1 }, "u2"),
    ).toThrow("locked");
    expect(DataCrypto.getUserDataKey("u1")).toBe(keys.dek);
    expect(DataCrypto.getUserDataKey("u2")).toBeNull();
  });
});

describe("migrating old plaintext rows", () => {
  function store() {
    const hosts = [
      { id: 1, password: "old-pw", key_password: null },
      {
        id: 2,
        password: FieldCrypto.encryptField("x", keys.dek, "2", "password"),
      },
    ];
    const credentials = [{ id: 9, private_key: "old-key" }];
    const updates: Array<[string, number, Record<string, unknown>]> = [];
    return {
      updates,
      listHostRecords: () => hosts,
      listCredentialRecords: () => credentials,
      updateHostSensitiveFields: (id: number, row: Record<string, unknown>) =>
        updates.push(["host", id, row]),
      updateCredentialSensitiveFields: (
        id: number,
        row: Record<string, unknown>,
      ) => updates.push(["cred", id, row]),
    };
  }

  it("seals plaintext secrets in hosts and credentials", async () => {
    const s = store();
    const result = await (
      DataCrypto as unknown as {
        migrateUserSensitiveFieldsInStore: (
          u: string,
          k: Buffer,
          st: unknown,
        ) => Promise<{
          migrated: boolean;
          migratedTables: string[];
          migratedFieldsCount: number;
        }>;
      }
    ).migrateUserSensitiveFieldsInStore("u1", keys.dek, s);
    expect(result).toEqual({
      migrated: true,
      migratedTables: ["ssh_data", "ssh_credentials"],
      migratedFieldsCount: 2,
    });
    expect(s.updates.map(([kind, id]) => `${kind}${id}`)).toEqual([
      "host1",
      "cred9",
    ]);
    const host = s.updates[0][2];
    expect(
      FieldCrypto.decryptField(
        host.password as string,
        keys.dek,
        "1",
        "password",
      ),
    ).toBe("old-pw");
  });

  it("does nothing when there is nothing to migrate and survives a broken store", async () => {
    const quiet = {
      listHostRecords: () => [],
      listCredentialRecords: () => [],
    };
    const run = (
      DataCrypto as unknown as {
        migrateUserSensitiveFieldsInStore: (
          u: string,
          k: Buffer,
          st: unknown,
        ) => Promise<{ migrated: boolean }>;
      }
    ).migrateUserSensitiveFieldsInStore.bind(DataCrypto);
    expect((await run("u1", keys.dek, quiet)).migrated).toBe(false);
    const broken = {
      listHostRecords: () => [{ id: 1, password: "pw" }],
      listCredentialRecords: () => [],
      updateHostSensitiveFields: () => {
        throw new Error("disk full");
      },
    };
    expect((await run("u1", keys.dek, broken)).migrated).toBe(false);
    expect(
      (
        await DataCrypto.migrateUserSensitiveFields(
          "u1",
          crypto.randomBytes(32),
          {} as never,
        )
      ).migrated,
    ).toBe(false);
  });
});
