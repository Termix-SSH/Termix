import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { TermixIdentityRepository } from "./termix-identity-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentTermixIdentityRepository(): TermixIdentityRepository {
  assertRepositoryRolloutDomainEnabled("termix_identity");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new TermixIdentityRepository(context, () =>
    DatabaseSaveTrigger.forceSave("termix_identity_repository_write"),
  );
}
