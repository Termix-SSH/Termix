import { AlertRepository } from "./alert-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentAlertRepository(): AlertRepository {
  assertRepositoryRolloutDomainEnabled("alerts");

  return new AlertRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("alert_repository_write"),
  );
}
