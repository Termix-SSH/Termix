import { C2sTunnelPresetRepository } from "./c2s-tunnel-preset-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentC2sTunnelPresetRepository(): C2sTunnelPresetRepository {
  assertRepositoryRolloutDomainEnabled("c2s_tunnel_presets");

  return new C2sTunnelPresetRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("c2s_tunnel_preset_repository_write"),
  );
}
