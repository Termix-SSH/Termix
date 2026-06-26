import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { RoleRepository } from "./role-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentRoleRepository(): RoleRepository {
  assertRepositoryRolloutDomainEnabled("roles");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new RoleRepository(context, () =>
    DatabaseSaveTrigger.forceSave("role_repository_write"),
  );
}
