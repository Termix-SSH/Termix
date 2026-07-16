import { FileManagerBookmarkRepository } from "./file-manager-bookmark-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentFileManagerBookmarkRepository(): FileManagerBookmarkRepository {
  assertRepositoryRolloutDomainEnabled("file_manager_bookmarks");

  return new FileManagerBookmarkRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("file_manager_bookmarks_repository_write"),
  );
}
