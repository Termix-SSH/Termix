import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { SessionShareRepository } from "../../../database/repositories/session-share-repository.js";

describe("SessionShareRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<SessionShareRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE ssh_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        ip TEXT
      );

      CREATE TABLE session_shares (
        id TEXT PRIMARY KEY,
        host_id INTEGER NOT NULL,
        owner_user_id TEXT NOT NULL,
        protocol TEXT NOT NULL,
        session_id TEXT NOT NULL,
        tab_instance_id TEXT,
        share_type TEXT NOT NULL,
        target_user_id TEXT,
        link_token TEXT UNIQUE,
        permission_level TEXT NOT NULL DEFAULT 'read-only',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        last_joined_at TEXT,
        join_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE session_share_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        share_id TEXT NOT NULL,
        user_id TEXT,
        guest_label TEXT,
        joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        left_at TEXT
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('owner-1', 'alice', 'hash'), ('guest-1', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip)
      VALUES (1, 'owner-1', 'host-one', '10.0.0.1'), (2, 'owner-1', 'host-two', '10.0.0.2');
    `);

    return new SessionShareRepository(context, onWrite);
  }

  const FAR_FUTURE = "2999-01-01T00:00:00.000Z";
  const FAR_PAST = "2000-01-01T00:00:00.000Z";

  it("creates a share and finds it by id", async () => {
    const repo = await createRepository();

    const created = await repo.create({
      id: "share-1",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-abc",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });

    expect(created).toMatchObject({
      id: "share-1",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      linkToken: "token-abc",
      permissionLevel: "read-only",
    });

    const found = await repo.findById("share-1");
    expect(found).toMatchObject({ id: "share-1", sessionId: "session-1" });
  });

  it("findByLinkToken excludes revoked shares", async () => {
    const repo = await createRepository();
    await repo.create({
      id: "share-revoked",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-revoked",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });

    expect(await repo.findByLinkToken("token-revoked")).not.toBeNull();

    await repo.revoke("share-revoked", "owner-1");

    expect(await repo.findByLinkToken("token-revoked")).toBeNull();
  });

  it("findByLinkToken excludes expired shares", async () => {
    const repo = await createRepository();
    await repo.create({
      id: "share-expired",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-expired",
      permissionLevel: "read-only",
      expiresAt: FAR_PAST,
    });

    expect(await repo.findByLinkToken("token-expired")).toBeNull();
  });

  it("findByLinkToken returns active, non-expired, non-revoked shares", async () => {
    const repo = await createRepository();
    await repo.create({
      id: "share-active",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "vnc",
      sessionId: "guac-session-1",
      shareType: "link",
      linkToken: "token-active",
      permissionLevel: "read-write",
      expiresAt: FAR_FUTURE,
    });

    const found = await repo.findByLinkToken("token-active");
    expect(found).toMatchObject({
      id: "share-active",
      protocol: "vnc",
      permissionLevel: "read-write",
    });
  });

  it("findSharesTargetingUser returns only active user-targeted shares with host/owner metadata", async () => {
    const repo = await createRepository();

    await repo.create({
      id: "share-user-active",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "user",
      targetUserId: "guest-1",
      permissionLevel: "read-write",
      expiresAt: FAR_FUTURE,
    });

    // Expired user share for the same target - must be excluded
    await repo.create({
      id: "share-user-expired",
      hostId: 2,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-2",
      shareType: "user",
      targetUserId: "guest-1",
      permissionLevel: "read-only",
      expiresAt: FAR_PAST,
    });

    // Link share, not targeting a user - must be excluded even though it's active
    await repo.create({
      id: "share-link-active",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-3",
      shareType: "link",
      linkToken: "token-unrelated",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });

    const shares = await repo.findSharesTargetingUser("guest-1");
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({
      id: "share-user-active",
      hostName: "host-one",
      ownerUsername: "alice",
    });
  });

  it("revoke only affects the requesting owner's own share", async () => {
    const repo = await createRepository();
    await repo.create({
      id: "share-owned",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-owned",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });

    expect(await repo.revoke("share-owned", "guest-1")).toBe(false);
    expect(await repo.revoke("share-owned", "owner-1")).toBe(true);
  });

  it("revokeAsAdmin revokes regardless of owner", async () => {
    const repo = await createRepository();
    await repo.create({
      id: "share-admin-target",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-admin",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });

    expect(await repo.revokeAsAdmin("share-admin-target")).toBe(true);
    expect(await repo.findByLinkToken("token-admin")).toBeNull();
  });

  it("deleteExpiredShares removes only expired rows", async () => {
    const repo = await createRepository();
    await repo.create({
      id: "share-old",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-old",
      permissionLevel: "read-only",
      expiresAt: FAR_PAST,
    });
    await repo.create({
      id: "share-current",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-2",
      shareType: "link",
      linkToken: "token-current",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });

    const deletedCount = await repo.deleteExpiredShares();
    expect(deletedCount).toBe(1);
    expect(await repo.findById("share-old")).toBeNull();
    expect(await repo.findById("share-current")).not.toBeNull();
  });

  it("touchShareUsage increments joinCount and sets lastJoinedAt", async () => {
    const repo = await createRepository();
    await repo.create({
      id: "share-touch",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-touch",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });

    await repo.touchShareUsage("share-touch", "2026-01-01T00:00:00.000Z");
    let row = await repo.findById("share-touch");
    expect(row?.joinCount).toBe(1);
    expect(row?.lastJoinedAt).toBe("2026-01-01T00:00:00.000Z");

    await repo.touchShareUsage("share-touch", "2026-01-02T00:00:00.000Z");
    row = await repo.findById("share-touch");
    expect(row?.joinCount).toBe(2);
  });

  it("records and closes participant joins", async () => {
    const repo = await createRepository();
    await repo.create({
      id: "share-participants",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-participants",
      permissionLevel: "read-write",
      expiresAt: FAR_FUTURE,
    });

    const participant = await repo.recordParticipantJoin(
      "share-participants",
      null,
      "Guest",
    );
    expect(participant).toMatchObject({
      shareId: "share-participants",
      userId: null,
      guestLabel: "Guest",
    });
    expect(participant.leftAt).toBeNull();

    await repo.recordParticipantLeave(participant.id);
  });

  it("write hook fires on mutating operations", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.create({
      id: "share-write-hook",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-write-hook",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });
    expect(writeCount).toBe(1);

    await repo.revoke("share-write-hook", "owner-1");
    expect(writeCount).toBe(2);
  });

  it("deleteSharesForHost removes all shares for a host", async () => {
    const repo = await createRepository();
    await repo.create({
      id: "share-host-1a",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "token-h1a",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });
    await repo.create({
      id: "share-host-1b",
      hostId: 1,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-2",
      shareType: "link",
      linkToken: "token-h1b",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });
    await repo.create({
      id: "share-host-2",
      hostId: 2,
      ownerUserId: "owner-1",
      protocol: "ssh",
      sessionId: "session-3",
      shareType: "link",
      linkToken: "token-h2",
      permissionLevel: "read-only",
      expiresAt: FAR_FUTURE,
    });

    expect(await repo.deleteSharesForHost(1)).toBe(2);
    expect(await repo.findById("share-host-2")).not.toBeNull();
  });
});
