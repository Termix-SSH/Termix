import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { HostRepository } from "./host-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentHostRepository(): HostRepository {
  assertRepositoryRolloutDomainEnabled("hosts");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new HostRepository(context, () =>
    DatabaseSaveTrigger.forceSave("host_repository_write"),
  );
}
