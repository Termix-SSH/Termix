import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { NetworkTopologyRepository } from "./network-topology-repository.js";

export function createCurrentNetworkTopologyRepository(): NetworkTopologyRepository {
  assertRepositoryRolloutDomainEnabled("network_topology");

  return new NetworkTopologyRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("network_topology_repository_write"),
  );
}
