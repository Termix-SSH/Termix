import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { CommandHistoryRepository } from "./command-history-repository.js";

export function createCurrentCommandHistoryRepository(): CommandHistoryRepository {
  assertRepositoryRolloutDomainEnabled("command_history");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new CommandHistoryRepository(context, () =>
    DatabaseSaveTrigger.forceSave("command_history_repository_write"),
  );
}
