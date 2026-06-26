import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { HostFolderRepository } from "./host-folder-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentHostFolderRepository(): HostFolderRepository {
  assertRepositoryRolloutDomainEnabled("host_folders");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new HostFolderRepository(context, () =>
    DatabaseSaveTrigger.forceSave("host_folder_repository_write"),
  );
}
