import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { HomepageLayoutRepository } from "./homepage-layout-repository.js";

export function createCurrentHomepageLayoutRepository(): HomepageLayoutRepository {
  assertRepositoryRolloutDomainEnabled("homepage_layouts");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new HomepageLayoutRepository(context, () =>
    DatabaseSaveTrigger.forceSave("homepage_layout_repository_write"),
  );
}
