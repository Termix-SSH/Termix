import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { HostMetricsHistoryRepository } from "./host-metrics-history-repository.js";

export function createCurrentHostMetricsHistoryRepository(): HostMetricsHistoryRepository {
  assertRepositoryRolloutDomainEnabled("host_metrics_history");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new HostMetricsHistoryRepository(context, () =>
    DatabaseSaveTrigger.forceSave("host_metrics_history_repository_write"),
  );
}
