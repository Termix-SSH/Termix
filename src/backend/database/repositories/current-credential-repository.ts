import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { CredentialRepository } from "./credential-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentCredentialRepository(): CredentialRepository {
  assertRepositoryRolloutDomainEnabled("credentials");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new CredentialRepository(context, () =>
    DatabaseSaveTrigger.forceSave("credential_repository_write"),
  );
}
