import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { SettingsRepository } from "./settings-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentSettingsRepository(): SettingsRepository {
  assertRepositoryRolloutDomainEnabled("settings");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new SettingsRepository(context, () =>
    DatabaseSaveTrigger.forceSave("settings_repository_write"),
  );
}

export function getCurrentSettingValue(key: string): string | null {
  assertRepositoryRolloutDomainEnabled("settings");

  const row = getSqlite()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value?: string } | undefined;

  return row?.value ?? null;
}
