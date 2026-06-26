import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { C2sTunnelPresetRepository } from "./c2s-tunnel-preset-repository.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentC2sTunnelPresetRepository(): C2sTunnelPresetRepository {
  assertRepositoryRolloutDomainEnabled("c2s_tunnel_presets");

  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new C2sTunnelPresetRepository(context, () =>
    DatabaseSaveTrigger.forceSave("c2s_tunnel_preset_repository_write"),
  );
}
