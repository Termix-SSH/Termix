import { HomepageItemRepository } from "./homepage-item-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentHomepageItemRepository(): HomepageItemRepository {
  assertRepositoryRolloutDomainEnabled("homepage_items");

  return new HomepageItemRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("homepage_item_repository_write"),
  );
}
