/**
 * Points 2.8 OIDC sign-ins at the provider row they came from.
 *
 * external-identity-migration.ts files a bare OIDC subject with no
 * users.sso_provider_id under "legacy-oidc", the id the sso plugin gives its
 * env-configured provider. Those accounts came from the single 2.8 OIDC
 * config, which 2.8 copied into an sso_providers row, and the plugin signs in
 * through that row with its id. Without this they could not sign in at all
 * (#1381).
 *
 * Only runs when the answer is clear: the env provider is not what signs in,
 * and exactly one OIDC row is from before 2.9. An identity whose target is
 * already taken (a duplicate account made by 2.9.0) is left for an admin.
 * Idempotent.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import {
  runStatement,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";

const LEGACY_OIDC_PROVIDER_ID = "legacy-oidc";
const SOURCES = ["p_sso_providers", "sso_providers"];

export interface SsoLegacyIdentityMigrationResult {
  moved: number;
  conflicts: number;
}

async function tableExists(name: string): Promise<boolean> {
  try {
    await selectRows(sql`SELECT 1 FROM ${sql.identifier(name)} WHERE 1 = 0`);
    return true;
  } catch {
    return false;
  }
}

function isOn(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t";
}

function envProviderConfigured(): boolean {
  return [
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "OIDC_ISSUER_URL",
    "OIDC_AUTHORIZATION_URL",
    "OIDC_TOKEN_URL",
  ].every((name) => !!process.env[name]);
}

interface ProviderRow {
  id: number;
  type: string;
  enabled: unknown;
  legacy_callback?: unknown;
}

async function readProviders(table: string): Promise<ProviderRow[]> {
  try {
    return await selectRows<ProviderRow>(
      sql`SELECT id, type, enabled, legacy_callback FROM ${sql.identifier(table)}`,
    );
  } catch {
    return await selectRows<ProviderRow>(
      sql`SELECT id, type, enabled FROM ${sql.identifier(table)}`,
    );
  }
}

/** The row "legacy-oidc" sign-ins belong to, or null when that is unclear. */
async function findTargetProvider(): Promise<number | null> {
  for (const table of SOURCES) {
    if (!(await tableExists(table))) continue;
    const rows = await readProviders(table);

    // The env provider signs in as "legacy-oidc" when it overrides the rows
    // or no row is enabled, so those identities are already right.
    const enabled = rows.filter((row) => isOn(row.enabled));
    if (
      envProviderConfigured() &&
      (process.env.OIDC_ENV_OVERRIDE?.toLowerCase() === "true" ||
        enabled.length === 0)
    ) {
      return null;
    }

    const oidc = rows.filter((row) => row.type === "oidc");
    const legacy = oidc.filter(
      (row) => row.legacy_callback === undefined || isOn(row.legacy_callback),
    );
    return legacy.length === 1 ? Number(legacy[0].id) : null;
  }
  return null;
}

export async function runSsoLegacyIdentityMigration(): Promise<SsoLegacyIdentityMigrationResult> {
  const result: SsoLegacyIdentityMigrationResult = { moved: 0, conflicts: 0 };
  try {
    const target = await findTargetProvider();
    if (target === null) return result;
    const providerId = String(target);

    // "github:null:<id>" also landed on "legacy-oidc", but its identifier
    // kept the prefix, so matching the bare column picks only OIDC ones.
    const identities = await selectRows<{
      id: number;
      user_id: string;
      subject: string;
    }>(
      sql`SELECT i.id, i.user_id, i.subject FROM user_external_identities i JOIN users u ON u.id = i.user_id WHERE i.provider_id = ${LEGACY_OIDC_PROVIDER_ID} AND u.oidc_identifier = i.subject`,
    );

    for (const identity of identities) {
      const [taken] = await selectRows<{ user_id: string }>(
        sql`SELECT user_id FROM user_external_identities WHERE provider_id = ${providerId} AND subject = ${identity.subject}`,
      );
      if (taken) {
        if (taken.user_id !== identity.user_id) {
          result.conflicts++;
          databaseLogger.warn(
            "An SSO subject is linked to two accounts; merge or delete the duplicate",
            {
              operation: "sso_legacy_identity_conflict",
              userId: identity.user_id,
              duplicateUserId: taken.user_id,
              providerId,
            },
          );
          continue;
        }
        await runStatement(
          sql`DELETE FROM user_external_identities WHERE id = ${identity.id}`,
        );
        result.moved++;
        continue;
      }
      await runStatement(
        sql`UPDATE user_external_identities SET provider_id = ${providerId} WHERE id = ${identity.id}`,
      );
      result.moved++;
    }

    if (result.moved > 0) {
      databaseLogger.info("Moved 2.8 OIDC sign-ins to their provider", {
        operation: "sso_legacy_identity_migration",
        providerId,
        ...result,
      });
    }
  } catch (error) {
    databaseLogger.error("SSO legacy identity migration failed", error, {
      operation: "sso_legacy_identity_migration_failed",
    });
  }
  return result;
}
