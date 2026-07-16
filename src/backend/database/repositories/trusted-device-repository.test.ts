import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { TrustedDeviceRepository } from "./trusted-device-repository.js";

describe("TrustedDeviceRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(onWrite?: () => void): Promise<{
    trustedDevices: TrustedDeviceRepository;
  }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE trusted_devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_fingerprint TEXT NOT NULL,
        device_type TEXT NOT NULL,
        device_info TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO users (id, username, password_hash) VALUES
        ('user-1', 'admin', 'hash'),
        ('user-2', 'user', 'hash');
    `);

    return {
      trustedDevices: new TrustedDeviceRepository(context, onWrite),
    };
  }

  it("upserts, touches, finds, and deletes trusted devices", async () => {
    const repo = await createRepository();

    await repo.trustedDevices.upsert({
      id: "device-1",
      userId: "user-1",
      deviceFingerprint: "fingerprint",
      deviceType: "desktop",
      deviceInfo: "Firefox",
      createdAt: "2026-06-26T00:00:00.000Z",
      expiresAt: "2026-07-26T00:00:00.000Z",
      lastUsedAt: "2026-06-26T00:00:00.000Z",
    });

    expect(
      (
        await repo.trustedDevices.findByUserAndFingerprint(
          "user-1",
          "fingerprint",
        )
      )?.deviceType,
    ).toBe("desktop");

    await repo.trustedDevices.touch(
      "user-1",
      "fingerprint",
      "2026-06-26T01:00:00.000Z",
    );
    expect(
      (
        await repo.trustedDevices.findByUserAndFingerprint(
          "user-1",
          "fingerprint",
        )
      )?.lastUsedAt,
    ).toBe("2026-06-26T01:00:00.000Z");

    await repo.trustedDevices.upsert({
      id: "device-ignored",
      userId: "user-1",
      deviceFingerprint: "fingerprint",
      deviceType: "mobile",
      deviceInfo: "Safari",
      expiresAt: "2026-08-26T00:00:00.000Z",
      lastUsedAt: "2026-06-26T02:00:00.000Z",
    });

    const updated = await repo.trustedDevices.findByUserAndFingerprint(
      "user-1",
      "fingerprint",
    );
    expect(updated?.id).toBe("device-1");
    expect(updated?.deviceType).toBe("desktop");
    expect(updated?.expiresAt).toBe("2026-08-26T00:00:00.000Z");

    await repo.trustedDevices.deleteByUserAndFingerprint(
      "user-1",
      "fingerprint",
    );
    expect(
      await repo.trustedDevices.findByUserAndFingerprint(
        "user-1",
        "fingerprint",
      ),
    ).toBeNull();
  });

  it("deletes all trusted devices for a user", async () => {
    const repo = await createRepository();

    for (const id of ["device-1", "device-2"]) {
      await repo.trustedDevices.upsert({
        id,
        userId: "user-2",
        deviceFingerprint: id,
        deviceType: "desktop",
        deviceInfo: "Firefox",
        expiresAt: "2026-07-26T00:00:00.000Z",
      });
    }

    await repo.trustedDevices.deleteByUserId("user-2");

    expect(
      await repo.trustedDevices.findByUserAndFingerprint("user-2", "device-1"),
    ).toBeNull();
    expect(
      await repo.trustedDevices.findByUserAndFingerprint("user-2", "device-2"),
    ).toBeNull();
  });

  it("runs the write hook after trusted device writes", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.trustedDevices.upsert({
      id: "device-1",
      userId: "user-1",
      deviceFingerprint: "fingerprint",
      deviceType: "desktop",
      deviceInfo: "Firefox",
      expiresAt: "2026-07-26T00:00:00.000Z",
    });
    await repo.trustedDevices.touch("user-1", "fingerprint");
    await repo.trustedDevices.deleteByUserAndFingerprint(
      "user-1",
      "fingerprint",
    );

    expect(writeCount).toBe(3);
  });
});
