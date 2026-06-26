import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { HomepageItemRepository } from "./homepage-item-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentHomepageItemRepository(): HomepageItemRepository {
  assertRepositoryRolloutDomainEnabled("homepage_items");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new HomepageItemRepository(context, () =>
    DatabaseSaveTrigger.forceSave("homepage_item_repository_write"),
  );
}
