import { SessionRepository } from "./session-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentSessionRepository(): SessionRepository {
  assertRepositoryRolloutDomainEnabled("sessions");

  return new SessionRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("session_repository_write"),
  );
}
