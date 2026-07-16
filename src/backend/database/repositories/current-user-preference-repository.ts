import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { UserPreferenceRepository } from "./user-preference-repository.js";

export function createCurrentUserPreferenceRepository(): UserPreferenceRepository {
  assertRepositoryRolloutDomainEnabled("user_preferences");

  return new UserPreferenceRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("user_preference_repository_write"),
  );
}
