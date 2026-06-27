import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { SharedCredentialRepository } from "./shared-credential-repository.js";

export function createCurrentSharedCredentialRepository(): SharedCredentialRepository {
  assertRepositoryRolloutDomainEnabled("shared_credentials");

  return new SharedCredentialRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("shared_credential_repository_write"),
  );
}
