import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { OpksshTokenRepository } from "./opkssh-token-repository.js";

export function createCurrentOpksshTokenRepository(): OpksshTokenRepository {
  assertRepositoryRolloutDomainEnabled("opkssh_tokens");

  return new OpksshTokenRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("opkssh_token_repository_write"),
  );
}
