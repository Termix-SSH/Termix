import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { DashboardServiceLinkRepository } from "./dashboard-service-link-repository.js";

export function createCurrentDashboardServiceLinkRepository(): DashboardServiceLinkRepository {
  assertRepositoryRolloutDomainEnabled("dashboard_service_links");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new DashboardServiceLinkRepository(context, () =>
    DatabaseSaveTrigger.forceSave("dashboard_service_link_repository_write"),
  );
}
