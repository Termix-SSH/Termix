import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { SshCredentialUsageRepository } from "./ssh-credential-usage-repository.js";

export function createCurrentSshCredentialUsageRepository(): SshCredentialUsageRepository {
  assertRepositoryRolloutDomainEnabled("ssh_credential_usage");

  return new SshCredentialUsageRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("ssh_credential_usage_repository_write"),
  );
}
