import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { DashboardServiceLinkRepository } from "./dashboard-service-link-repository.js";

export function createCurrentDashboardServiceLinkRepository(): DashboardServiceLinkRepository {
  assertRepositoryRolloutDomainEnabled("dashboard_service_links");

  return new DashboardServiceLinkRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("dashboard_service_link_repository_write"),
  );
}
