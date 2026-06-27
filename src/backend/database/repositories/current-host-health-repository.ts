import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { HostHealthRepository } from "./host-health-repository.js";

export function createCurrentHostHealthRepository(): HostHealthRepository {
  assertRepositoryRolloutDomainEnabled("host_health");

  return new HostHealthRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_health_repository_write"),
  );
}
