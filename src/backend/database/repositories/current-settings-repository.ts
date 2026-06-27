import { SettingsRepository } from "./settings-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
  getCurrentRepositorySqlite,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentSettingsRepository(): SettingsRepository {
  assertRepositoryRolloutDomainEnabled("settings");

  return new SettingsRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("settings_repository_write"),
  );
}

export function getCurrentSettingValue(key: string): string | null {
  assertRepositoryRolloutDomainEnabled("settings");

  const row = getCurrentRepositorySqlite()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value?: string } | undefined;

  return row?.value ?? null;
}
