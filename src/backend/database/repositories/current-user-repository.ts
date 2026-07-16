import { UserRepository } from "./user-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentUserRepository(): UserRepository {
  assertRepositoryRolloutDomainEnabled("users");

  return new UserRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("user_repository_write"),
  );
}
