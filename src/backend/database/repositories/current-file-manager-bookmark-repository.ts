import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { FileManagerBookmarkRepository } from "./file-manager-bookmark-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentFileManagerBookmarkRepository(): FileManagerBookmarkRepository {
  assertRepositoryRolloutDomainEnabled("file_manager_bookmarks");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new FileManagerBookmarkRepository(context, () =>
    DatabaseSaveTrigger.forceSave("file_manager_bookmarks_repository_write"),
  );
}
