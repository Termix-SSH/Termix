import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { VaultTokenRepository } from "./vault-token-repository.js";

export function createCurrentVaultTokenRepository(): VaultTokenRepository {
  assertRepositoryRolloutDomainEnabled("vault_tokens");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new VaultTokenRepository(context, () =>
    DatabaseSaveTrigger.forceSave("vault_token_repository_write"),
  );
}
