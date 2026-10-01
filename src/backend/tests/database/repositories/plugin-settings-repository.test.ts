import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { TestSqliteDatabase, testDialect } from "./test-support.js";
import { PluginSettingsRepository } from "../../../database/repositories/plugin-settings-repository.js";

describe("PluginSettingsRepository", () => {
  let adapter: TestSqliteDatabase;
  let repo: PluginSettingsRepository;
  const pluginId = "p".repeat(255);

  beforeEach(async () => {
    adapter = new TestSqliteDatabase();
    repo = new PluginSettingsRepository(await adapter.connect());
    await adapter.run(sql`
      INSERT INTO plugins (id, name, version, manifest_json)
      VALUES (${pluginId}, 'Settings test', '1.0.0', '{}')
    `);
  });

  afterEach(async () => {
    await adapter.close();
  });

  it("round-trips every supported scope and updates admin settings", async () => {
    for (const scope of ["admin", "user", "host", "secret"] as const) {
      const scopeId = scope === "admin" ? null : "42";
      await repo.set(pluginId, scope, scopeId, "shared-key", scope);
      expect(
        await repo.get(pluginId, scope, scopeId, "shared-key"),
      ).toMatchObject({
        scope,
        value: scope,
      });
    }
    await repo.set(pluginId, "admin", null, "shared-key", "updated");
    expect(await repo.getAll(pluginId, "admin", null)).toHaveLength(1);
    expect(await repo.get(pluginId, "admin", null, "shared-key")).toMatchObject(
      {
        value: "updated",
      },
    );
  });

  it("preserves full-length Unicode identifiers and distinct key suffixes", async () => {
    const scopeId = "\u{1f511}".repeat(255);
    const prefix = "\u{1f511}".repeat(254);
    await repo.set(pluginId, "user", scopeId, `${prefix}a`, "first");
    await repo.set(pluginId, "user", scopeId, `${prefix}b`, "second");
    expect(await repo.getAll(pluginId, "user", scopeId)).toHaveLength(2);
    expect(
      await repo.get(pluginId, "user", scopeId, `${prefix}a`),
    ).toMatchObject({
      value: "first",
    });
    expect(
      await repo.get(pluginId, "user", scopeId, `${prefix}b`),
    ).toMatchObject({
      value: "second",
    });
  });

  it("still rejects duplicate non-null scope keys at the database boundary", async () => {
    await repo.set(pluginId, "host", "42", "setting", "original");
    await expect(
      adapter.run(sql`
        INSERT INTO plugin_settings (plugin_id, scope, scope_id, ${sql.identifier("key")}, value)
        VALUES (${pluginId}, 'host', '42', 'setting', 'duplicate')
      `),
    ).rejects.toThrow();
    expect(await repo.get(pluginId, "host", "42", "setting")).toMatchObject({
      value: "original",
    });
  });

  it.runIf(testDialect() === "mysql")(
    "preserves existing settings through the enum upgrade",
    async () => {
      const migrationDir = new URL(
        "../../../../../drizzle/mysql/",
        import.meta.url,
      );
      const create = readFileSync(
        new URL("0029_open_captain_america.sql", migrationDir),
        "utf8",
      )
        .split("--> statement-breakpoint")[0]
        .replace("`plugin_settings`", "`plugin_settings_upgrade_test`")
        .replace("enum('admin','user','host','secret')", "varchar(255)")
        .replace(/\);\s*$/, ") DEFAULT CHARSET=utf8mb3;");
      const upgrade = readFileSync(
        new URL("0061_plugin_settings_scope_enum.sql", migrationDir),
        "utf8",
      ).replace("`plugin_settings`", "`plugin_settings_upgrade_test`");
      await adapter.run(sql.raw(create));
      try {
        for (const scope of ["admin", "user", "host", "secret"]) {
          await adapter.run(sql`
          INSERT INTO plugin_settings_upgrade_test (plugin_id, scope, scope_id, ${sql.identifier("key")}, value, encrypted)
          VALUES (${pluginId}, ${scope}, ${scope === "admin" ? null : "42"}, 'setting', ${scope}, true)
        `);
        }
        const before = await adapter.query(
          sql`SELECT * FROM plugin_settings_upgrade_test ORDER BY id`,
        );
        await adapter.run(sql.raw(upgrade));
        expect(
          await adapter.query(
            sql`SELECT * FROM plugin_settings_upgrade_test ORDER BY id`,
          ),
        ).toEqual(before);
      } finally {
        await adapter.run(sql`DROP TABLE plugin_settings_upgrade_test`);
      }
    },
  );
});
