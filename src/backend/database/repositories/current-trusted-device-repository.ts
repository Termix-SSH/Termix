import { getDb, getSqlite } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import type { DatabaseContext } from "../runtime/adapter.js";
import { TrustedDeviceRepository } from "./trusted-device-repository.js";

export function createCurrentTrustedDeviceRepository(): TrustedDeviceRepository {
  const context: DatabaseContext = {
    dialect: "sqlite",
    drizzle: getDb(),
    sqlite: getSqlite(),
  };

  return new TrustedDeviceRepository(context, () =>
    DatabaseSaveTrigger.forceSave("trusted_device_repository_write"),
  );
}
