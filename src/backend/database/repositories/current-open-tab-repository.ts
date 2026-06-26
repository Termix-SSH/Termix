import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { OpenTabRepository } from "./open-tab-repository.js";

export function createCurrentOpenTabRepository(): OpenTabRepository {
  assertRepositoryRolloutDomainEnabled("open_tabs");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new OpenTabRepository(context, () =>
    DatabaseSaveTrigger.forceSave("open_tab_repository_write"),
  );
}
