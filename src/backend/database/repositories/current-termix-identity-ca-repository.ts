import { TermixIdentityCaRepository } from "./termix-identity-ca-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentTermixIdentityCaRepository(): TermixIdentityCaRepository {
  assertRepositoryRolloutDomainEnabled("termix_identity_ca");

  return new TermixIdentityCaRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("termix_identity_ca_repository_write"),
  );
}
