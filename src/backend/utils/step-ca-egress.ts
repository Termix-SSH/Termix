import { createCurrentSettingsRepository } from "../database/repositories/factory.js";
import { parseNotificationAllowlist } from "./notification-egress.js";

/** Private hosts (a CA on the LAN, an internal IdP) the Step CA flow may reach. */
export const STEP_CA_PRIVATE_ALLOWLIST_KEY =
  "step_ca_private_endpoint_allowlist";

export async function readStepCaPrivateAllowlist(): Promise<string[]> {
  const raw = await createCurrentSettingsRepository().get(
    STEP_CA_PRIVATE_ALLOWLIST_KEY,
  );
  return parseNotificationAllowlist(raw);
}
