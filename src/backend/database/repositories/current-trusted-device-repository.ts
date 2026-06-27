import { TrustedDeviceRepository } from "./trusted-device-repository.js";
import {
  createCurrentRepositoryContext,
  createCurrentRepositoryWriteHook,
} from "./current-repository-runtime.js";
import { assertRepositoryRolloutDomainEnabled } from "./repository-rollout.js";

export function createCurrentTrustedDeviceRepository(): TrustedDeviceRepository {
  assertRepositoryRolloutDomainEnabled("trusted_devices");

  return new TrustedDeviceRepository(
    createCurrentRepositoryContext(),
    createCurrentRepositoryWriteHook("trusted_device_repository_write"),
  );
}
