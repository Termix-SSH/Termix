import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { TransferRecentRepository } from "./transfer-recent-repository.js";

export function createCurrentTransferRecentRepository(): TransferRecentRepository {
  assertRepositoryRolloutDomainEnabled("transfer_recent");

  return new TransferRecentRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("transfer_recent_repository_write"),
  );
}
