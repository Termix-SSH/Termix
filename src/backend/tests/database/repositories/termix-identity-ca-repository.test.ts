import { afterEach, describe, expect, vi } from "vitest";
import { TestSqliteDatabase, itSqliteOnly } from "./test-support.js";
import { DataCrypto } from "../../../utils/data-crypto.js";
import { TermixIdentityCaRepository } from "../../../database/repositories/termix-identity-ca-repository.js";

describe("TermixIdentityCaRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(onWrite = vi.fn()): Promise<{
    repo: TermixIdentityCaRepository;
    sqlite: NonNullable<
      Awaited<ReturnType<TestSqliteDatabase["connect"]>>["sqlite"]
    >;
    onWrite: ReturnType<typeof vi.fn>;
  }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash');
      INSERT INTO termix_identities (id, user_id, handle)
      VALUES (7, 'user-1', 'alice');
    `);

    return {
      repo: new TermixIdentityCaRepository(context, onWrite),
      get sqlite() {
        return adapter!.raw;
      },
      onWrite,
    };
  }

  function mockCrypto(): void {
    vi.spyOn(DataCrypto, "validateUserAccess").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "encryptRecord").mockImplementation(
      (_tableName, record) =>
        ({
          ...record,
          privateKey: "encrypted-ca-private",
        }) as typeof record,
    );
    vi.spyOn(DataCrypto, "decryptRecord").mockImplementation(
      (_tableName, record) =>
        ({
          ...record,
          privateKey:
            record.privateKey === "encrypted-ca-private"
              ? "decrypted-ca-private"
              : record.privateKey,
        }) as typeof record,
    );
  }

  itSqliteOnly(
    "creates CA private keys with the real row id before encryption",
    async () => {
      const { repo, sqlite, onWrite } = await createRepository();
      mockCrypto();

      const created = await repo.createEncryptedForUser("user-1", {
        identityId: 7,
        userId: "user-1",
        publicKey: "ssh-ed25519 public",
        privateKey: "plain-ca-private",
        validityDays: 120,
      });

      const raw = sqlite
        .prepare(
          "SELECT id, public_key, private_key, validity_days FROM termix_identity_ca WHERE identity_id = ?",
        )
        .get(7) as {
        id: number;
        public_key: string;
        private_key: string;
        validity_days: number;
      };

      expect(created.privateKey).toBe("decrypted-ca-private");
      expect(raw.private_key).toBe("encrypted-ca-private");
      expect(raw.public_key).toBe("ssh-ed25519 public");
      expect(raw.validity_days).toBe(120);
      expect(DataCrypto.encryptRecord).toHaveBeenCalledWith(
        "termix_identity_ca",
        { id: raw.id, privateKey: "plain-ca-private" },
        "user-1",
        Buffer.from("user-key"),
      );
      expect(onWrite).toHaveBeenCalledTimes(1);
    },
  );

  itSqliteOnly(
    "reads public CA metadata without decrypting private key material",
    async () => {
      const { repo, sqlite } = await createRepository();
      const decryptSpy = vi.spyOn(DataCrypto, "decryptRecord");
      sqlite
        .prepare(
          "INSERT INTO termix_identity_ca (identity_id, user_id, public_key, private_key, validity_days) VALUES (?, ?, ?, ?, ?)",
        )
        .run(7, "user-1", "ssh-ed25519 public", "encrypted-ca-private", 45);

      await expect(repo.findPublicByIdentityId(7)).resolves.toEqual({
        publicKey: "ssh-ed25519 public",
        validityDays: 45,
      });
      expect(decryptSpy).not.toHaveBeenCalled();
    },
  );

  itSqliteOnly(
    "decrypts CA private keys through the user data boundary",
    async () => {
      const { repo, sqlite } = await createRepository();
      mockCrypto();
      sqlite
        .prepare(
          "INSERT INTO termix_identity_ca (identity_id, user_id, public_key, private_key, validity_days) VALUES (?, ?, ?, ?, ?)",
        )
        .run(7, "user-1", "ssh-ed25519 public", "encrypted-ca-private", 45);

      const ca = await repo.findDecryptedByIdentityId("user-1", 7);

      expect(ca).toMatchObject({
        identityId: 7,
        publicKey: "ssh-ed25519 public",
        privateKey: "decrypted-ca-private",
        validityDays: 45,
      });
      expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
        "termix_identity_ca",
        expect.objectContaining({ identityId: 7 }),
        "user-1",
        Buffer.from("user-key"),
      );
    },
  );

  itSqliteOnly("updates CA private keys through encrypted writes", async () => {
    const { repo, sqlite, onWrite } = await createRepository();
    mockCrypto();
    sqlite
      .prepare(
        "INSERT INTO termix_identity_ca (identity_id, user_id, public_key, private_key, validity_days) VALUES (?, ?, ?, ?, ?)",
      )
      .run(7, "user-1", "ssh-ed25519 old", "encrypted-ca-private", 45);
    onWrite.mockClear();

    const updated = await repo.updateEncryptedForIdentity("user-1", 7, {
      publicKey: "ssh-ed25519 new",
      privateKey: "plain-updated-ca-private",
      validityDays: 90,
    });

    const raw = sqlite
      .prepare(
        "SELECT public_key, private_key, validity_days FROM termix_identity_ca WHERE identity_id = ?",
      )
      .get(7) as {
      public_key: string;
      private_key: string;
      validity_days: number;
    };

    expect(updated).toMatchObject({
      publicKey: "ssh-ed25519 new",
      privateKey: "decrypted-ca-private",
      validityDays: 90,
    });
    expect(raw).toEqual({
      public_key: "ssh-ed25519 new",
      private_key: "encrypted-ca-private",
      validity_days: 90,
    });
    expect(DataCrypto.encryptRecord).toHaveBeenCalledWith(
      "termix_identity_ca",
      expect.objectContaining({
        privateKey: "plain-updated-ca-private",
      }),
      "user-1",
      Buffer.from("user-key"),
    );
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  itSqliteOnly("deletes CA rows through the write boundary", async () => {
    const { repo, sqlite, onWrite } = await createRepository();
    sqlite
      .prepare(
        "INSERT INTO termix_identity_ca (identity_id, user_id, public_key, private_key, validity_days) VALUES (?, ?, ?, ?, ?)",
      )
      .run(7, "user-1", "ssh-ed25519 public", "encrypted-ca-private", 45);
    onWrite.mockClear();

    await expect(repo.deleteByIdentityId(7)).resolves.toBe(true);
    await expect(repo.deleteByIdentityId(7)).resolves.toBe(false);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM termix_identity_ca").get(),
    ).toEqual({ count: 0 });
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  itSqliteOnly("deletes CA rows for a user", async () => {
    const { repo, sqlite, onWrite } = await createRepository();
    sqlite
      .prepare(
        "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
      )
      .run("user-2", "bob", "hash");
    sqlite
      .prepare(
        "INSERT INTO termix_identities (id, user_id, handle) VALUES (?, ?, ?)",
      )
      .run(8, "user-2", "bob");
    sqlite
      .prepare(
        "INSERT INTO termix_identity_ca (identity_id, user_id, public_key, private_key, validity_days) VALUES (?, ?, ?, ?, ?)",
      )
      .run(7, "user-1", "ssh-ed25519 public", "encrypted-ca-private", 45);
    sqlite
      .prepare(
        "INSERT INTO termix_identity_ca (identity_id, user_id, public_key, private_key, validity_days) VALUES (?, ?, ?, ?, ?)",
      )
      .run(8, "user-2", "ssh-ed25519 other", "encrypted-other", 90);
    onWrite.mockClear();

    await expect(repo.deleteByUserId("user-1")).resolves.toBe(1);
    await expect(repo.deleteByUserId("missing")).resolves.toBe(0);

    expect(
      sqlite
        .prepare(
          "SELECT user_id, public_key FROM termix_identity_ca ORDER BY user_id",
        )
        .all(),
    ).toEqual([{ user_id: "user-2", public_key: "ssh-ed25519 other" }]);
    expect(onWrite).toHaveBeenCalledTimes(1);
  });
});
