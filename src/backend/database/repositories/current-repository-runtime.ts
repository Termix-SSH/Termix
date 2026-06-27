import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { getDb, getSqlite } from "../db/index.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export function createCurrentRepositoryContext(): DatabaseContext {
  return {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };
}

export function createCurrentRepositoryWriteHook(
  reason: string,
): () => Promise<void> {
  return () => DatabaseSaveTrigger.forceSave(reason);
}

export function getCurrentRepositorySqlite() {
  return getSqlite();
}
