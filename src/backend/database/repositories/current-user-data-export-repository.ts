import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";
import { createCurrentRepositoryContext } from "./current-repository-runtime.js";
import { UserDataExportRepository } from "./user-data-export-repository.js";

export function createCurrentUserDataExportRepository(): UserDataExportRepository {
  assertRepositoryRolloutDomainEnabled("user_data_exports");

  return new UserDataExportRepository(createCurrentRepositoryContext());
}
