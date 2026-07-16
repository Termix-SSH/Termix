import { HostFolderRepository } from "./host-folder-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentHostFolderRepository(): HostFolderRepository {
  assertRepositoryRolloutDomainEnabled("host_folders");

  return new HostFolderRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("host_folder_repository_write"),
  );
}
