import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { DismissedAlertRepository } from "./dismissed-alert-repository.js";

export function createCurrentDismissedAlertRepository(): DismissedAlertRepository {
  assertRepositoryRolloutDomainEnabled("dismissed_alerts");

  return new DismissedAlertRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("dismissed_alert_repository_write"),
  );
}
