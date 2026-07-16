import { SnippetRepository } from "./snippet-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentSnippetRepository(): SnippetRepository {
  assertRepositoryRolloutDomainEnabled("snippets");

  return new SnippetRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("snippet_repository_write"),
  );
}
