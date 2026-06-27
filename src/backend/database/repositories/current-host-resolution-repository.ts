import { HostResolutionRepository } from "./host-resolution-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentHostResolutionRepository(): HostResolutionRepository {
  assertRepositoryRolloutDomainEnabled("host_resolution");

  return new HostResolutionRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_resolution_repository_write"),
  );
}
