import { RoleRepository } from "./role-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentRoleRepository(): RoleRepository {
  assertRepositoryRolloutDomainEnabled("roles");

  return new RoleRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("role_repository_write"),
  );
}
