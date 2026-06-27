import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { TmuxSessionTagRepository } from "./tmux-session-tag-repository.js";

export function createCurrentTmuxSessionTagRepository(): TmuxSessionTagRepository {
  assertRepositoryRolloutDomainEnabled("tmux_session_tags");

  return new TmuxSessionTagRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("tmux_session_tag_repository_write"),
  );
}
