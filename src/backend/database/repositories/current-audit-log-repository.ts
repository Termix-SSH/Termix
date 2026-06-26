import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { AuditLogRepository } from "./audit-log-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentAuditLogRepository(): AuditLogRepository {
  assertRepositoryRolloutDomainEnabled("audit_logs");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new AuditLogRepository(context, () =>
    DatabaseSaveTrigger.forceSave("audit_log_repository_write"),
  );
}
