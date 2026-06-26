import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { TransferRecentRepository } from "./transfer-recent-repository.js";

export function createCurrentTransferRecentRepository(): TransferRecentRepository {
  assertRepositoryRolloutDomainEnabled("transfer_recent");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new TransferRecentRepository(context, () =>
    DatabaseSaveTrigger.forceSave("transfer_recent_repository_write"),
  );
}
