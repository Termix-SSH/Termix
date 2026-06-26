import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { HostHealthRepository } from "./host-health-repository.js";

export function createCurrentHostHealthRepository(): HostHealthRepository {
  assertRepositoryRolloutDomainEnabled("host_health");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new HostHealthRepository(context, () =>
    DatabaseSaveTrigger.forceSave("host_health_repository_write"),
  );
}
