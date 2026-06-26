import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { SessionRecordingRepository } from "./session-recording-repository.js";

export function createCurrentSessionRecordingRepository(): SessionRecordingRepository {
  assertRepositoryRolloutDomainEnabled("session_recordings");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new SessionRecordingRepository(context, () =>
    DatabaseSaveTrigger.forceSave("session_recording_repository_write"),
  );
}
