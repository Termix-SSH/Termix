import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { HostMetricsPreferenceRepository } from "./host-metrics-preference-repository.js";

export function createCurrentHostMetricsPreferenceRepository(): HostMetricsPreferenceRepository {
  assertRepositoryRolloutDomainEnabled("host_metrics_preferences");

  return new HostMetricsPreferenceRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook(
      "host_metrics_preference_repository_write",
    ),
  );
}
