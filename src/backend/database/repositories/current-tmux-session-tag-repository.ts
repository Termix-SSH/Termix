import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { TmuxSessionTagRepository } from "./tmux-session-tag-repository.js";

export function createCurrentTmuxSessionTagRepository(): TmuxSessionTagRepository {
  assertRepositoryRolloutDomainEnabled("tmux_session_tags");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new TmuxSessionTagRepository(context, () =>
    DatabaseSaveTrigger.forceSave("tmux_session_tag_repository_write"),
  );
}
