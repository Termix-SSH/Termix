import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: logs,
}));

const { TestSqliteDatabase } = await import("./test-support.js");
const {
  AuditLogRepository,
  auditRetentionDays,
  auditMaxEntries,
  AUDIT_RETENTION_DAYS_ENV,
  AUDIT_MAX_ENTRIES_ENV,
} = await import("../../../database/repositories/audit-log-repository.js");

let adapter: InstanceType<typeof TestSqliteDatabase> | null = null;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  logs.info.mockReset();
  logs.warn.mockReset();
  for (const key of [AUDIT_RETENTION_DAYS_ENV, AUDIT_MAX_ENTRIES_ENV]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (adapter) {
    await adapter.close();
    adapter = null;
  }
});

async function createRepository() {
  adapter = new TestSqliteDatabase();
  const context = await adapter.connect();
  adapter.exec(`
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      resource_name TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      success INTEGER NOT NULL,
      error_message TEXT,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return new AuditLogRepository(context);
}

function daysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function seed(
  repo: Awaited<ReturnType<typeof createRepository>>,
  timestamp: string,
  action = "create_host",
) {
  await repo.create({
    userId: "u-1",
    username: "alice",
    action,
    resourceType: "host",
    success: true,
    timestamp,
  });
}

describe("audit retention configuration", () => {
  it("has no time limit unless one is configured", () => {
    expect(auditRetentionDays({})).toBeNull();
    expect(auditRetentionDays({ [AUDIT_RETENTION_DAYS_ENV]: "90" })).toBe(90);
  });

  it("ignores values that are not a positive count", () => {
    for (const bad of ["0", "-5", "", "abc"]) {
      expect(
        auditRetentionDays({ [AUDIT_RETENTION_DAYS_ENV]: bad }),
      ).toBeNull();
    }
  });

  it("falls back to the built-in cap", () => {
    expect(auditMaxEntries({})).toBe(10000);
    expect(auditMaxEntries({ [AUDIT_MAX_ENTRIES_ENV]: "250" })).toBe(250);
    expect(auditMaxEntries({ [AUDIT_MAX_ENTRIES_ENV]: "-1" })).toBe(10000);
  });
});

describe("audit retention pruning", () => {
  it("keeps everything when no retention is set", async () => {
    const repo = await createRepository();

    await seed(repo, daysAgo(400));
    await seed(repo, daysAgo(1));

    const { total } = await repo.listPage({
      filters: {},
      limit: 10,
      offset: 0,
    });
    expect(total).toBe(2);
    expect(logs.info).not.toHaveBeenCalled();
  });

  it("drops entries past the retention window and says so", async () => {
    process.env[AUDIT_RETENTION_DAYS_ENV] = "30";
    const repo = await createRepository();

    await seed(repo, daysAgo(90), "old_action");
    await seed(repo, daysAgo(5), "recent_action");

    const { logs: rows } = await repo.listPage({
      filters: {},
      limit: 10,
      offset: 0,
    });
    expect(rows.map((r) => r.action)).toEqual(["recent_action"]);

    expect(logs.info).toHaveBeenCalledWith(
      expect.stringContaining("past retention"),
      expect.objectContaining({ operation: "audit_retention_prune" }),
    );
  });

  it("warns when the row cap discards entries still inside the window", async () => {
    process.env[AUDIT_MAX_ENTRIES_ENV] = "5";
    const repo = await createRepository();

    for (let i = 0; i < 6; i++) {
      await seed(repo, daysAgo(10 - i), `action_${i}`);
    }

    // The cap is not a retention policy: these entries were still current.
    expect(logs.warn).toHaveBeenCalledWith(
      expect.stringContaining("cap"),
      expect.objectContaining({
        operation: "audit_overflow_prune",
        maxEntries: 5,
      }),
    );

    const { total } = await repo.listPage({
      filters: {},
      limit: 20,
      offset: 0,
    });
    expect(total).toBeLessThan(6);
  });

  it("stays quiet while under the cap", async () => {
    process.env[AUDIT_MAX_ENTRIES_ENV] = "100";
    const repo = await createRepository();

    await seed(repo, daysAgo(1));

    expect(logs.warn).not.toHaveBeenCalled();
  });
});
