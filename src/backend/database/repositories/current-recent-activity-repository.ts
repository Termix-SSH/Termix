import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { RecentActivityRepository } from "./recent-activity-repository.js";

export function createCurrentRecentActivityRepository(): RecentActivityRepository {
  assertRepositoryRolloutDomainEnabled("recent_activity");

  return new RecentActivityRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("recent_activity_repository_write"),
  );
}
