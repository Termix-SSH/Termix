import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { SsoProviderRepository } from "./sso-provider-repository.js";

export function createCurrentSsoProviderRepository(): SsoProviderRepository {
  assertRepositoryRolloutDomainEnabled("sso_providers");

  return new SsoProviderRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("sso_provider_repository_write"),
  );
}
