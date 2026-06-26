import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { SshCredentialUsageRepository } from "./ssh-credential-usage-repository.js";

export function createCurrentSshCredentialUsageRepository(): SshCredentialUsageRepository {
  assertRepositoryRolloutDomainEnabled("ssh_credential_usage");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new SshCredentialUsageRepository(context, () =>
    DatabaseSaveTrigger.forceSave("ssh_credential_usage_repository_write"),
  );
}
