import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { UserPreferenceRepository } from "./user-preference-repository.js";

export function createCurrentUserPreferenceRepository(): UserPreferenceRepository {
  assertRepositoryRolloutDomainEnabled("user_preferences");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new UserPreferenceRepository(context, () =>
    DatabaseSaveTrigger.forceSave("user_preference_repository_write"),
  );
}
