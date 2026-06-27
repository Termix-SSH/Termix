import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { CommandHistoryRepository } from "./command-history-repository.js";

export function createCurrentCommandHistoryRepository(): CommandHistoryRepository {
  assertRepositoryRolloutDomainEnabled("command_history");

  return new CommandHistoryRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("command_history_repository_write"),
  );
}
