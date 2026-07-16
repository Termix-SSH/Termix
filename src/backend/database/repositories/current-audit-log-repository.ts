import { AuditLogRepository } from "./audit-log-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentAuditLogRepository(): AuditLogRepository {
  assertRepositoryRolloutDomainEnabled("audit_logs");

  return new AuditLogRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("audit_log_repository_write"),
  );
}
