import { HostRepository } from "./host-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentHostRepository(): HostRepository {
  assertRepositoryRolloutDomainEnabled("hosts");

  return new HostRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_repository_write"),
  );
}
