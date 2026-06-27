import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { SharedCredentialRepository } from "./shared-credential-repository.js";

export function createCurrentSharedCredentialRepository(): SharedCredentialRepository {
  assertRepositoryRolloutDomainEnabled("shared_credentials");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new SharedCredentialRepository(context, () =>
    DatabaseSaveTrigger.forceSave("shared_credential_repository_write"),
  );
}
