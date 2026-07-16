import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { HomepageLayoutRepository } from "./homepage-layout-repository.js";

export function createCurrentHomepageLayoutRepository(): HomepageLayoutRepository {
  assertRepositoryRolloutDomainEnabled("homepage_layouts");

  return new HomepageLayoutRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("homepage_layout_repository_write"),
  );
}
