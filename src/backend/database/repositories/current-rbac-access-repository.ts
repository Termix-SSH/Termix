import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { RbacAccessRepository } from "./rbac-access-repository.js";

export function createCurrentRbacAccessRepository(): RbacAccessRepository {
  assertRepositoryRolloutDomainEnabled("rbac_access");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new RbacAccessRepository(context, () =>
    DatabaseSaveTrigger.forceSave("rbac_access_repository_write"),
  );
}
