import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { RbacAccessRepository } from "./rbac-access-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";

export function createCurrentRbacAccessRepository(): RbacAccessRepository {
  assertRepositoryRolloutDomainEnabled("rbac_access");

  return new RbacAccessRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("rbac_access_repository_write"),
  );
}
