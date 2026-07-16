import { ApiKeyRepository } from "./api-key-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentApiKeyRepository(): ApiKeyRepository {
  assertRepositoryRolloutDomainEnabled("api_keys");

  return new ApiKeyRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("api_key_repository_write"),
  );
}
