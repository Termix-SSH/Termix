import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { UserRepository } from "./user-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentUserRepository(): UserRepository {
  assertRepositoryRolloutDomainEnabled("users");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new UserRepository(context, () =>
    DatabaseSaveTrigger.forceSave("user_repository_write"),
  );
}
