import { getDb, getSqlite } from "../db/index.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { SnippetRepository } from "./snippet-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentSnippetRepository(): SnippetRepository {
  assertRepositoryRolloutDomainEnabled("snippets");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new SnippetRepository(context);
}
