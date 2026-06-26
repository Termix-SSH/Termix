import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { SessionRepository } from "./session-repository.js";

export function createCurrentSessionRepository(): SessionRepository {
  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new SessionRepository(context, () =>
    DatabaseSaveTrigger.forceSave("session_repository_write"),
  );
}
