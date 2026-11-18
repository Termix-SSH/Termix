import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestSqliteDatabase } from "../database/repositories/test-support.js";
import { AuditLogRepository } from "../../database/repositories/audit-log-repository.js";
import { SettingsRepository } from "../../database/repositories/settings-repository.js";
import type { DatabaseContext } from "../../database/repositories/database-context.js";

let context: DatabaseContext | null = null;
const sendCoreAlert = vi.fn();

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentAuditLogRepository: () => new AuditLogRepository(context!),
  createCurrentSettingsRepository: () => new SettingsRepository(context!),
}));
vi.mock("../../notify/core-notify.js", () => ({
  sendCoreAlert: (...args: unknown[]) => sendCoreAlert(...args),
}));

import {
  checkSavedHead,
  runAuditChainCheck,
  verifyAuditChain,
} from "../../utils/audit-chain.js";
import { auditRowHash } from "../../utils/audit-chain-hash.js";

describe("audit chain", () => {
  let adapter: TestSqliteDatabase;
  let repo: AuditLogRepository;

  beforeEach(async () => {
    AuditLogRepository.resetPruneThrottleForTests();
    adapter = new TestSqliteDatabase();
    context = await adapter.connect();
    await adapter.exec(
      "INSERT INTO users (id, username, password_hash) VALUES ('user-1', 'alice', 'hash');",
    );
    repo = new AuditLogRepository(context);
    sendCoreAlert.mockReset();
  });

  afterEach(async () => {
    delete process.env.AUDIT_LOG_MAX_ENTRIES;
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
    await adapter.close();
    context = null;
  });

  async function write(count: number, action = "login"): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await repo.create({
        userId: "user-1",
        username: "alice",
        action: `${action}_${i}`,
        resourceType: "session",
        success: true,
      });
    }
  }

  it("links each row to the one before", async () => {
    await write(3);
    const rows = await repo.listChainBatch(0, 10);
    expect(rows).toHaveLength(3);
    expect(rows[0].prevHash).toBe("0".repeat(64));
    expect(rows[1].prevHash).toBe(rows[0].hash);
    expect(rows[2].prevHash).toBe(rows[1].hash);
    expect(rows[2].hash).toBe(
      auditRowHash(rows[1].hash!, {
        ...rows[2],
        timestamp: String(rows[2].timestamp),
      }),
    );

    const result = await verifyAuditChain();
    expect(result).toMatchObject({ ok: true, checked: 3, unchained: 0 });
    expect(result.head).toMatchObject({ id: rows[2].id, hash: rows[2].hash });
  });

  it("serializes writes made at the same time", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        repo.create({
          username: "alice",
          action: `burst_${i}`,
          resourceType: "session",
          success: true,
          userId: null,
        }),
      ),
    );
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("finds a changed row", async () => {
    await write(4);
    await adapter.exec(
      "UPDATE audit_logs SET action = 'nothing' WHERE id = 2;",
    );
    expect(await verifyAuditChain()).toMatchObject({
      ok: false,
      brokenAt: 2,
      problem: "row_changed",
    });
  });

  it("finds a row removed from the middle", async () => {
    await write(4);
    await adapter.exec("DELETE FROM audit_logs WHERE id = 2;");
    expect(await verifyAuditChain()).toMatchObject({
      ok: false,
      brokenAt: 3,
      problem: "row_missing",
    });
  });

  it("finds removed newest rows", async () => {
    await write(4);
    await adapter.exec("DELETE FROM audit_logs WHERE id >= 3;");
    expect(await verifyAuditChain()).toMatchObject({
      ok: false,
      problem: "head_mismatch",
    });
  });

  it("finds a hash wiped inside the chain", async () => {
    await write(3);
    await adapter.exec(
      "UPDATE audit_logs SET hash = NULL, prev_hash = NULL WHERE id = 2;",
    );
    expect(await verifyAuditChain()).toMatchObject({
      ok: false,
      brokenAt: 2,
      problem: "hash_removed",
    });
  });

  it("counts rows from before the chain and starts after them", async () => {
    await adapter.exec(
      "INSERT INTO audit_logs (username, action, resource_type, success) VALUES ('old', 'login', 'session', 1), ('old', 'login', 'session', 1);",
    );
    await write(2);
    expect(await verifyAuditChain()).toMatchObject({
      ok: true,
      checked: 2,
      unchained: 2,
    });
  });

  it("stays valid when a user is deleted", async () => {
    await write(3);
    await repo.anonymizeByUserId("user-1");
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("stays valid after the row cap prunes the oldest rows", async () => {
    process.env.AUDIT_LOG_MAX_ENTRIES = "10";
    await write(25);
    const result = await verifyAuditChain();
    expect(result.ok).toBe(true);
    expect(result.checked).toBeLessThanOrEqual(10);
    expect((await repo.readChainPoints()).anchor).not.toBeNull();
  });

  it("stays valid after retention prunes everything", async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "1";
    await write(2);
    vi.useFakeTimers({
      now: new Date("2100-01-01T00:00:00Z"),
      toFake: ["Date"],
    });
    try {
      await repo.pruneNow();
    } finally {
      vi.useRealTimers();
    }
    expect(await repo.listChainBatch(0, 10)).toHaveLength(0);
    expect((await verifyAuditChain()).ok).toBe(true);
    await write(1);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("checks a head saved earlier", async () => {
    await write(3);
    const saved = (await verifyAuditChain()).head!;
    await write(2);
    expect(await checkSavedHead(saved)).toMatchObject({
      found: true,
      ok: true,
    });

    // A rewrite of the whole chain no longer matches the saved head.
    await adapter.exec(
      `UPDATE audit_logs SET hash = '${"a".repeat(64)}' WHERE id = ${saved.id};`,
    );
    expect(await checkSavedHead(saved)).toMatchObject({ found: false });
  });

  it("alerts admins once per break", async () => {
    await write(3);
    await adapter.exec("UPDATE audit_logs SET action = 'x' WHERE id = 1;");
    expect((await runAuditChainCheck()).ok).toBe(false);
    expect((await runAuditChainCheck()).ok).toBe(false);
    expect(sendCoreAlert).toHaveBeenCalledTimes(1);
    expect(sendCoreAlert).toHaveBeenCalledWith(
      expect.objectContaining({ audience: "admins", severity: "critical" }),
    );
  });
});
