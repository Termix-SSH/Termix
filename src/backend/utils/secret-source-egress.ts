import { createCurrentSettingsRepository } from "../database/repositories/factory.js";
import { parseNotificationAllowlist } from "./notification-egress.js";

/** Private hosts (a self-hosted 1Password Connect server) secret sources may reach. */
export const SECRET_SOURCE_PRIVATE_ALLOWLIST_KEY =
  "secret_source_private_endpoint_allowlist";

export async function readSecretSourcePrivateAllowlist(): Promise<string[]> {
  const raw = await createCurrentSettingsRepository().get(
    SECRET_SOURCE_PRIVATE_ALLOWLIST_KEY,
  );
  return parseNotificationAllowlist(raw);
}
