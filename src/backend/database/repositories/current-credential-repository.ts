import { CredentialRepository } from "./credential-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentCredentialRepository(): CredentialRepository {
  assertRepositoryRolloutDomainEnabled("credentials");

  return new CredentialRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("credential_repository_write"),
  );
}
