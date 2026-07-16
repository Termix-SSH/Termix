import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { HostMetricsHistoryRepository } from "./host-metrics-history-repository.js";

export function createCurrentHostMetricsHistoryRepository(): HostMetricsHistoryRepository {
  assertRepositoryRolloutDomainEnabled("host_metrics_history");

  return new HostMetricsHistoryRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_metrics_history_repository_write"),
  );
}
