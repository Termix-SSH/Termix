import { getDb, getSqlite } from "../db/index.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { UserDataExportRepository } from "./user-data-export-repository.js";

export function createCurrentUserDataExportRepository(): UserDataExportRepository {
  assertRepositoryRolloutDomainEnabled("user_data_exports");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new UserDataExportRepository(context);
}
