import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { AlertRepository } from "./alert-repository.js";

describe("AlertRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<AlertRepository> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT,
        ip TEXT NOT NULL
      );

      CREATE TABLE alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        trigger_type TEXT NOT NULL,
        threshold_value REAL,
        threshold_duration_seconds INTEGER,
        cooldown_minutes INTEGER NOT NULL DEFAULT 15,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE notification_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE alert_rule_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id INTEGER NOT NULL,
        channel_id INTEGER NOT NULL
      );

      CREATE TABLE alert_firings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        rule_id INTEGER NOT NULL,
        host_id INTEGER NOT NULL,
        host_name TEXT NOT NULL,
        fired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT,
        value REAL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'warning',
        acknowledged INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO hosts (id, user_id, name, ip)
      VALUES (1, 'user-1', 'alpha', '127.0.0.1');
    `);

    return new AlertRepository(context, onWrite);
  }

  it("manages notification channels", async () => {
    let writes = 0;
    const repo = await createRepository(() => {
      writes += 1;
    });

    const created = await repo.createNotificationChannel({
      userId: "user-1",
      name: "Ops",
      type: "webhook",
      config: '{"url":"https://example.test"}',
      enabled: true,
    });

    expect(created).toMatchObject({
      user_id: "user-1",
      name: "Ops",
      type: "webhook",
      enabled: 1,
    });

    const updated = await repo.updateNotificationChannel(created.id, "user-1", {
      name: "Ops disabled",
      enabled: false,
    });
    expect(updated).toMatchObject({ name: "Ops disabled", enabled: 0 });

    expect(await repo.listNotificationChannels("user-1")).toHaveLength(1);
    expect(await repo.deleteNotificationChannel(created.id, "user-2")).toBe(
      false,
    );
    expect(await repo.deleteNotificationChannel(created.id, "user-1")).toBe(
      true,
    );
    expect(await repo.listNotificationChannels("user-1")).toHaveLength(0);
    expect(writes).toBe(3);
  });

  it("manages alert rules and linked channels", async () => {
    const repo = await createRepository();
    const ownedChannel = await repo.createNotificationChannel({
      userId: "user-1",
      name: "Owned",
      type: "ntfy",
      config: '{"url":"https://ntfy.test","topic":"termix"}',
      enabled: true,
    });
    const foreignChannel = await repo.createNotificationChannel({
      userId: "user-2",
      name: "Foreign",
      type: "webhook",
      config: '{"url":"https://example.test"}',
      enabled: true,
    });

    const created = await repo.createAlertRule({
      userId: "user-1",
      hostId: null,
      name: "CPU high",
      enabled: true,
      triggerType: "cpu_threshold",
      thresholdValue: 80,
      thresholdDurationSeconds: 30,
      cooldownMinutes: 5,
      channels: [ownedChannel.id, foreignChannel.id],
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(created).toMatchObject({
      user_id: "user-1",
      host_id: null,
      name: "CPU high",
      trigger_type: "cpu_threshold",
      threshold_value: 80,
      channels: [ownedChannel.id],
    });

    const updated = await repo.updateAlertRule(created.id, "user-1", {
      name: "CPU very high",
      hostId: 1,
      channels: [],
      now: "2026-01-02T00:00:00.000Z",
    });
    expect(updated).toMatchObject({
      name: "CPU very high",
      host_id: 1,
      channels: [],
      updated_at: "2026-01-02T00:00:00.000Z",
    });

    const rules = await repo.listAlertRules("user-1");
    expect(rules).toHaveLength(1);
    expect(rules[0].channels).toEqual([]);
    expect(await repo.deleteAlertRule(created.id, "user-2")).toBe(false);
    expect(await repo.deleteAlertRule(created.id, "user-1")).toBe(true);
  });

  it("lists, acknowledges, and prunes firings", async () => {
    const repo = await createRepository();
    const rule = await repo.createAlertRule({
      userId: "user-1",
      hostId: 1,
      name: "Host offline",
      enabled: true,
      triggerType: "host_offline",
      thresholdValue: null,
      thresholdDurationSeconds: null,
      cooldownMinutes: 15,
      channels: [],
      now: "2026-01-01T00:00:00.000Z",
    });

    await repo.createFiring({
      userId: "user-1",
      ruleId: rule.id,
      hostId: 1,
      hostName: "alpha",
      value: null,
      message: "down",
      severity: "critical",
    });

    const listed = await repo.listAlertFirings({
      userId: "user-1",
      limit: 10,
      offset: 0,
    });
    expect(listed.total).toBe(1);
    expect(listed.firings[0]).toMatchObject({
      rule_id: rule.id,
      host_name: "alpha",
      acknowledged: 0,
      rule_name: "Host offline",
    });

    await repo.acknowledgeFiring(listed.firings[0].id, "user-1");
    const unacknowledged = await repo.listAlertFirings({
      userId: "user-1",
      acknowledged: false,
      limit: 10,
      offset: 0,
    });
    expect(unacknowledged.total).toBe(0);

    await repo.acknowledgeAllFirings("user-1");
    repo.pruneFiringsOlderThan("user-1", 0);
  });

  it("loads enabled rules and notification channels for the alert engine", async () => {
    const repo = await createRepository();
    const channel = await repo.createNotificationChannel({
      userId: "user-1",
      name: "Ops",
      type: "webhook",
      config: '{"url":"https://example.test"}',
      enabled: true,
    });
    const disabledChannel = await repo.createNotificationChannel({
      userId: "user-1",
      name: "Disabled",
      type: "webhook",
      config: '{"url":"https://disabled.test"}',
      enabled: false,
    });
    const rule = await repo.createAlertRule({
      userId: "user-1",
      hostId: null,
      name: "CPU high",
      enabled: true,
      triggerType: "cpu_threshold",
      thresholdValue: 90,
      thresholdDurationSeconds: 0,
      cooldownMinutes: 15,
      channels: [channel.id, disabledChannel.id],
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(await repo.listEnabledRulesForHost(1)).toMatchObject([
      {
        id: rule.id,
        userId: "user-1",
        triggerType: "cpu_threshold",
        enabled: true,
      },
    ]);
    expect(await repo.findRuleById(rule.id)).toMatchObject({
      id: rule.id,
      cooldownMinutes: 15,
    });
    expect(await repo.listEnabledChannelsForRule(rule.id)).toEqual([
      {
        id: channel.id,
        type: "webhook",
        config: '{"url":"https://example.test"}',
        enabled: true,
      },
    ]);
  });
});
