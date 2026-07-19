import { describe, expect, it, vi } from "vitest";
import { RawSqliteUserEncryptionMigrationStore } from "../../utils/user-encryption-migration-store.js";

describe("RawSqliteUserEncryptionMigrationStore", () => {
  function createDb() {
    const all = vi.fn(() => [{ id: 1 }]);
    const get = vi.fn(() => ({ id: "user-1" }));
    const run = vi.fn();
    const prepare = vi.fn(() => ({ all, get, run }));

    return { db: { prepare }, all, get, run };
  }

  it("owns legacy user encryption migration reads", () => {
    const { db, all, get } = createDb();
    const store = new RawSqliteUserEncryptionMigrationStore(db);

    expect(store.listHostRecords("user-1")).toEqual([{ id: 1 }]);
    expect(store.listCredentialRecords("user-1")).toEqual([{ id: 1 }]);
    expect(store.getUserRecord("user-1")).toEqual({ id: "user-1" });

    expect(db.prepare).toHaveBeenCalledWith(
      "SELECT * FROM ssh_data WHERE user_id = ?",
    );
    expect(db.prepare).toHaveBeenCalledWith(
      "SELECT * FROM ssh_credentials WHERE user_id = ?",
    );
    expect(db.prepare).toHaveBeenCalledWith("SELECT * FROM users WHERE id = ?");
    expect(all).toHaveBeenCalledWith("user-1");
    expect(get).toHaveBeenCalledWith("user-1");
  });

  it("owns legacy sensitive field update statements", () => {
    const { db, run } = createDb();
    const store = new RawSqliteUserEncryptionMigrationStore(db);

    store.updateHostSensitiveFields(12, {
      password: "p",
      key: "k",
      key_password: "kp",
      key_type: "ed25519",
      autostart_password: "ap",
      autostart_key: "ak",
      autostart_key_password: "akp",
      sudo_password: "sp",
    });
    store.updateCredentialSensitiveFields(13, {
      password: "p",
      key: "k",
      key_password: "kp",
      private_key: "priv",
      public_key: "pub",
      key_type: "rsa",
    });
    store.updateUserSensitiveFields("user-1", {
      totp_secret: "totp",
      totp_backup_codes: "codes",
      client_secret: "client",
      oidc_identifier: "oidc",
    });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE ssh_data"),
    );
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE ssh_credentials"),
    );
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users"),
    );
    expect(run).toHaveBeenCalledWith(
      "p",
      "k",
      "kp",
      "ed25519",
      "ap",
      "ak",
      "akp",
      "sp",
      12,
    );
    expect(run).toHaveBeenCalledWith("p", "k", "kp", "priv", "pub", "rsa", 13);
    expect(run).toHaveBeenCalledWith(
      "totp",
      "codes",
      "client",
      "oidc",
      "user-1",
    );
  });

  it("owns password-reset dynamic field updates", () => {
    const { db, run } = createDb();
    const store = new RawSqliteUserEncryptionMigrationStore(db);

    store.updatePasswordResetFields(
      "ssh_credentials",
      99,
      ["password", "key"],
      { password: "p", key: "k" },
    );

    expect(db.prepare).toHaveBeenCalledWith(
      "UPDATE ssh_credentials SET password = ?, key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    );
    expect(run).toHaveBeenCalledWith("p", "k", 99);
  });
});
