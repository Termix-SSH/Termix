import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { AlertRepository } from "./alert-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentAlertRepository(): AlertRepository {
  assertRepositoryRolloutDomainEnabled("alerts");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new AlertRepository(context, () =>
    DatabaseSaveTrigger.forceSave("alert_repository_write"),
  );
}
