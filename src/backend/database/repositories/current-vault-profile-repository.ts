import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { VaultProfileRepository } from "./vault-profile-repository.js";

export function createCurrentVaultProfileRepository(): VaultProfileRepository {
  assertRepositoryRolloutDomainEnabled("vault_profiles");

  return new VaultProfileRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("vault_profile_repository_write"),
  );
}
