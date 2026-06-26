import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { HostMetricsPreferenceRepository } from "./host-metrics-preference-repository.js";

export function createCurrentHostMetricsPreferenceRepository(): HostMetricsPreferenceRepository {
  assertRepositoryRolloutDomainEnabled("host_metrics_preferences");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new HostMetricsPreferenceRepository(context, () =>
    DatabaseSaveTrigger.forceSave("host_metrics_preference_repository_write"),
  );
}
