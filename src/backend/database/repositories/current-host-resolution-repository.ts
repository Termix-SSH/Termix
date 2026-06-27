import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { HostResolutionRepository } from "./host-resolution-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentHostResolutionRepository(): HostResolutionRepository {
  assertRepositoryRolloutDomainEnabled("host_resolution");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new HostResolutionRepository(context, () =>
    DatabaseSaveTrigger.forceSave("host_resolution_repository_write"),
  );
}
