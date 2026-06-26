import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { DismissedAlertRepository } from "./dismissed-alert-repository.js";

export function createCurrentDismissedAlertRepository(): DismissedAlertRepository {
  assertRepositoryRolloutDomainEnabled("dismissed_alerts");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new DismissedAlertRepository(context, () =>
    DatabaseSaveTrigger.forceSave("dismissed_alert_repository_write"),
  );
}
