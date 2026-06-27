import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { TermixIdentityCaRepository } from "./termix-identity-ca-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentTermixIdentityCaRepository(): TermixIdentityCaRepository {
  assertRepositoryRolloutDomainEnabled("termix_identity_ca");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new TermixIdentityCaRepository(context, () =>
    DatabaseSaveTrigger.forceSave("termix_identity_ca_repository_write"),
  );
}
