import { TermixIdentityRepository } from "./termix-identity-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentTermixIdentityRepository(): TermixIdentityRepository {
  assertRepositoryRolloutDomainEnabled("termix_identity");

  return new TermixIdentityRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("termix_identity_repository_write"),
  );
}
