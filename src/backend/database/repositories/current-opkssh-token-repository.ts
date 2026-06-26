import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { OpksshTokenRepository } from "./opkssh-token-repository.js";

export function createCurrentOpksshTokenRepository(): OpksshTokenRepository {
  assertRepositoryRolloutDomainEnabled("opkssh_tokens");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new OpksshTokenRepository(context, () =>
    DatabaseSaveTrigger.forceSave("opkssh_token_repository_write"),
  );
}
