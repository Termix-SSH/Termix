import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { NetworkTopologyRepository } from "./network-topology-repository.js";

export function createCurrentNetworkTopologyRepository(): NetworkTopologyRepository {
  assertRepositoryRolloutDomainEnabled("network_topology");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new NetworkTopologyRepository(context, () =>
    DatabaseSaveTrigger.forceSave("network_topology_repository_write"),
  );
}
