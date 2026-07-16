import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { SessionRecordingRepository } from "./session-recording-repository.js";

export function createCurrentSessionRecordingRepository(): SessionRecordingRepository {
  assertRepositoryRolloutDomainEnabled("session_recordings");

  return new SessionRecordingRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("session_recording_repository_write"),
  );
}
