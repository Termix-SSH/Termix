import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { VaultTokenRepository } from "./vault-token-repository.js";

export function createCurrentVaultTokenRepository(): VaultTokenRepository {
  assertRepositoryRolloutDomainEnabled("vault_tokens");

  return new VaultTokenRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("vault_token_repository_write"),
  );
}
