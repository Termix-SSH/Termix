/**
 * Admin view and reset of a user's second factors. Covers factors whose
 * plugin is disabled or gone, which is exactly when a user gets locked out
 * and an admin has to step in.
 */

import {
  createCurrentTrustedDeviceRepository,
  createCurrentUserAuthRepository,
} from "../database/repositories/factory.js";
import { authLogger } from "../utils/logger.js";
import { ensureCoreLoginProviders } from "./core-auth.js";
import { getSecondFactor, listSecondFactors } from "./registry.js";

export interface UserSecondFactorSummary {
  pluginId: string;
  factorId: string;
  labelKey: string | null;
  /** False when the plugin behind it is not running. */
  available: boolean;
}

export async function listUserSecondFactors(
  userId: string,
): Promise<UserSecondFactorSummary[]> {
  ensureCoreLoginProviders();
  const rows =
    await createCurrentUserAuthRepository().listSecondFactors(userId);
  const summaries: UserSecondFactorSummary[] = rows.map((row) => {
    const factor = getSecondFactor(row.pluginId, row.factorId);
    return {
      pluginId: row.pluginId,
      factorId: row.factorId,
      labelKey: factor?.labelKey ?? null,
      available: !!factor,
    };
  });

  for (const factor of listSecondFactors()) {
    if (
      summaries.some(
        (summary) =>
          summary.pluginId === factor.pluginId &&
          summary.factorId === factor.id,
      )
    ) {
      continue;
    }
    if (await factor.isEnrolled(userId).catch(() => false)) {
      summaries.push({
        pluginId: factor.pluginId,
        factorId: factor.id,
        labelKey: factor.labelKey,
        available: true,
      });
    }
  }
  return summaries;
}

/**
 * Removes every factor: runs each running factor's own reset (so TOTP clears
 * its secret), drops the enrolment rows including orphaned ones, and forgets
 * trusted devices so an old "remember me" cannot skip the new factor.
 */
export async function resetUserSecondFactors(
  userId: string,
): Promise<Array<{ pluginId: string; factorId: string }>> {
  const factors = await listUserSecondFactors(userId);
  for (const summary of factors) {
    const factor = getSecondFactor(summary.pluginId, summary.factorId);
    if (!factor?.reset) continue;
    try {
      await factor.reset(userId);
    } catch (error) {
      authLogger.error("Second factor reset failed", error, {
        operation: "admin_reset_second_factor",
        userId,
        factorId: summary.factorId,
      });
    }
  }
  await createCurrentUserAuthRepository().clearSecondFactors(userId);
  await createCurrentTrustedDeviceRepository().deleteByUserId(userId);
  return factors.map(({ pluginId, factorId }) => ({ pluginId, factorId }));
}
