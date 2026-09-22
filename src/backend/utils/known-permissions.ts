import {
  createCurrentRbacPermissionRepository,
  createCurrentRoleRepository,
} from "../database/repositories/factory.js";
import {
  loadKnownPermissions,
  rememberPermissionGroup,
  isValidPermission,
} from "./permission-catalog.js";
import { databaseLogger } from "./logger.js";

function isConcretePermission(permission: string): boolean {
  return permission !== "*" && !permission.endsWith(".*");
}

/**
 * Loads every permission core has ever registered, and backfills the record
 * from what roles already hold.
 *
 * The backfill is what makes the upgrade lossless. Before A5 a plugin
 * permission existed only in memory while its plugin was active, so an install
 * upgrading with the ai plugin disabled would have had `ai.use` rejected on the
 * next role save. Seeding from the roles themselves means anything an admin was
 * already relying on stays valid, whether or not the plugin ever loads again.
 */
export async function primeKnownPermissions(): Promise<void> {
  try {
    const rbacRepository = createCurrentRbacPermissionRepository();

    const stored = await rbacRepository.listKnown();
    for (const row of stored) {
      if (isConcretePermission(row.permission)) {
        loadKnownPermissions([row.permission]);
      } else {
        // A stored "<group>.*" row records a group nothing concrete named.
        rememberPermissionGroup(row.permission.slice(0, -2));
      }
    }

    const fromRoles = new Set<string>();
    for (const role of await createCurrentRoleRepository().listRoles()) {
      if (!role.permissions) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(role.permissions);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const permission of parsed) {
        if (typeof permission !== "string") continue;
        // Already known, from the static catalog or a previous boot.
        if (isValidPermission(permission)) continue;

        // A role holding only "ai.*" still has to keep saving, so the group is
        // remembered even though the wildcard itself is not a stored id.
        if (!isConcretePermission(permission)) {
          rememberPermissionGroup(permission.slice(0, -2));
        }
        // Wildcards are stored too, so the group survives the next restart.
        fromRoles.add(permission);
      }
    }

    if (fromRoles.size === 0) return;

    loadKnownPermissions(
      [...fromRoles].filter((permission) => isConcretePermission(permission)),
    );
    await rbacRepository.recordKnown(
      [...fromRoles].map((permission) => ({ permission })),
    );

    databaseLogger.info(
      `Recorded ${fromRoles.size} permission(s) already held by a role`,
      { operation: "prime_known_permissions" },
    );
  } catch (error) {
    // A failure here only means a plugin permission may be rejected on a role
    // save until its plugin registers again. It must never stop the boot.
    databaseLogger.warn("Could not load known permissions", {
      operation: "prime_known_permissions",
      error,
    });
  }
}
