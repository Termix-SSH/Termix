import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialSystemEncryptionMigration } from "./credential-system-encryption-migration.js";
import { DataCrypto } from "./data-crypto.js";
import { FieldCrypto } from "./field-crypto.js";
import { SystemCrypto } from "./system-crypto.js";

const credentialRepository = {
  listMissingSystemEncryptionByUserId: vi.fn(),
  updateSystemEncryptionForUser: vi.fn(),
};

const sharedCredentialRepository = {
  markNeedsReEncryptionByOriginalCredentialId: vi.fn(),
};

vi.mock("../database/repositories/current-credential-repository.js", () => ({
  createCurrentCredentialRepository: vi.fn(() => credentialRepository),
}));

vi.mock(
  "../database/repositories/current-shared-credential-repository.js",
  () => ({
    createCurrentSharedCredentialRepository: vi.fn(
      () => sharedCredentialRepository,
    ),
  }),
);

describe("CredentialSystemEncryptionMigration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    credentialRepository.listMissingSystemEncryptionByUserId.mockReset();
    credentialRepository.updateSystemEncryptionForUser.mockReset();
    sharedCredentialRepository.markNeedsReEncryptionByOriginalCredentialId.mockReset();
  });

  it("migrates missing credential system-key copies through repositories", async () => {
    vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(
      SystemCrypto.getInstance(),
      "getCredentialSharingKey",
    ).mockResolvedValue(Buffer.from("system-key"));
    vi.spyOn(FieldCrypto, "decryptField").mockImplementation(
      (_value, _key, _recordId, fieldName) => `plain-${fieldName}`,
    );
    vi.spyOn(FieldCrypto, "encryptField").mockImplementation(
      (value, _key, _recordId, fieldName) => `system-${fieldName}-${value}`,
    );
    credentialRepository.listMissingSystemEncryptionByUserId.mockResolvedValue([
      {
        id: 123,
        userId: "user-1",
        password: "encrypted-password",
        key: "encrypted-key",
        keyPassword: "encrypted-key-password",
      },
    ]);

    await expect(
      new CredentialSystemEncryptionMigration().migrateUserCredentials(
        "user-1",
      ),
    ).resolves.toEqual({ migrated: 1, failed: 0, skipped: 0 });

    expect(
      credentialRepository.listMissingSystemEncryptionByUserId,
    ).toHaveBeenCalledWith("user-1");
    expect(
      credentialRepository.updateSystemEncryptionForUser,
    ).toHaveBeenCalledWith(
      "user-1",
      123,
      expect.objectContaining({
        systemPassword: "system-password-plain-password",
        systemKey: "system-key-plain-key",
        systemKeyPassword: "system-key_password-plain-keyPassword",
      }),
    );
    expect(
      sharedCredentialRepository.markNeedsReEncryptionByOriginalCredentialId,
    ).toHaveBeenCalledWith(123);
  });
});
