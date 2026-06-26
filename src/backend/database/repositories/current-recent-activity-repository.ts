import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { RecentActivityRepository } from "./recent-activity-repository.js";

export function createCurrentRecentActivityRepository(): RecentActivityRepository {
  assertRepositoryRolloutDomainEnabled("recent_activity");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new RecentActivityRepository(context, () =>
    DatabaseSaveTrigger.forceSave("recent_activity_repository_write"),
  );
}
