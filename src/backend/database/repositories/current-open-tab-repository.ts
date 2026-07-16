import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { OpenTabRepository } from "./open-tab-repository.js";

export function createCurrentOpenTabRepository(): OpenTabRepository {
  assertRepositoryRolloutDomainEnabled("open_tabs");

  return new OpenTabRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("open_tab_repository_write"),
  );
}
