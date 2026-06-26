import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { VaultProfileRepository } from "./vault-profile-repository.js";

export function createCurrentVaultProfileRepository(): VaultProfileRepository {
  assertRepositoryRolloutDomainEnabled("vault_profiles");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new VaultProfileRepository(context, () =>
    DatabaseSaveTrigger.forceSave("vault_profile_repository_write"),
  );
}
