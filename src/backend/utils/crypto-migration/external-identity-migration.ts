/**
 * Moves sign-in identities and 2FA enrolment into their own tables.
 *
 * users.oidc_identifier packed provider and subject into one string:
 * "ldap:<provider>:<id>", "github:<provider>:<id>", or a bare OIDC subject
 * whose provider was users.sso_provider_id. Each becomes a
 * user_external_identities row. users.totp_enabled becomes a
 * user_second_factors row for core's TOTP factor, so a login can tell a user
 * has a factor even after the plugin that runs it is gone.
 *
 * Lossless: the old column and flag are left as they are. Idempotent: rows
 * that already exist are skipped, so it runs on every boot.
 */

import { databaseLogger } from "../logger.js";
import {
  createCurrentUserAuthRepository,
  createCurrentUserRepository,
} from "../../database/repositories/factory.js";

/** Matches LEGACY_OIDC_PROVIDER_ID in auth/legacy/oidc-login.ts. */
const LEGACY_OIDC_PROVIDER_ID = "legacy-oidc";

export interface ExternalIdentityMigrationResult {
  identities: number;
  factors: number;
  skipped: number;
}

/** Splits a stored identifier into provider and subject. */
export function parseLegacyIdentifier(
  identifier: string,
  ssoProviderId: number | null | undefined,
): { providerId: string; subject: string } | null {
  if (!identifier) return null;

  const prefixed = /^(ldap|github):([^:]+):(.+)$/.exec(identifier);
  if (prefixed) {
    const provider = prefixed[2];
    return {
      providerId:
        provider === "null" || provider === "undefined"
          ? LEGACY_OIDC_PROVIDER_ID
          : provider,
      subject: prefixed[3],
    };
  }

  return {
    providerId:
      ssoProviderId !== null && ssoProviderId !== undefined
        ? String(ssoProviderId)
        : LEGACY_OIDC_PROVIDER_ID,
    subject: identifier,
  };
}

export async function runExternalIdentityMigration(): Promise<ExternalIdentityMigrationResult> {
  const result: ExternalIdentityMigrationResult = {
    identities: 0,
    factors: 0,
    skipped: 0,
  };

  try {
    const users = await createCurrentUserRepository().listAll();
    const auth = createCurrentUserAuthRepository();

    for (const user of users) {
      if (user.oidcIdentifier) {
        const parsed = parseLegacyIdentifier(
          user.oidcIdentifier,
          user.ssoProviderId,
        );
        if (parsed) {
          const existing = await auth.findIdentity(
            parsed.providerId,
            parsed.subject,
          );
          if (existing) {
            result.skipped++;
          } else {
            await auth.linkIdentity({
              userId: user.id,
              providerId: parsed.providerId,
              subject: parsed.subject,
            });
            result.identities++;
          }
        }
      }

      if (user.totpEnabled) {
        const enrolled = await auth.listSecondFactors(user.id);
        if (
          enrolled.some(
            (row) => row.pluginId === "core" && row.factorId === "totp",
          )
        ) {
          result.skipped++;
        } else {
          await auth.recordSecondFactor(user.id, "core", "totp");
          result.factors++;
        }
      }
    }

    if (result.identities > 0 || result.factors > 0) {
      databaseLogger.info("Moved sign-in identities and 2FA enrolment", {
        operation: "external_identity_migration",
        ...result,
      });
    }
  } catch (error) {
    databaseLogger.error("External identity migration failed", error, {
      operation: "external_identity_migration",
    });
  }

  return result;
}
