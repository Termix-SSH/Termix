import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { ApiKeyRepository } from "./api-key-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentApiKeyRepository(): ApiKeyRepository {
  assertRepositoryRolloutDomainEnabled("api_keys");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new ApiKeyRepository(context, () =>
    DatabaseSaveTrigger.forceSave("api_key_repository_write"),
  );
}
