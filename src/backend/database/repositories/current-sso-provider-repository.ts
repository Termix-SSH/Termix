import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { SsoProviderRepository } from "./sso-provider-repository.js";

export function createCurrentSsoProviderRepository(): SsoProviderRepository {
  assertRepositoryRolloutDomainEnabled("sso_providers");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new SsoProviderRepository(context, () =>
    DatabaseSaveTrigger.forceSave("sso_provider_repository_write"),
  );
}
