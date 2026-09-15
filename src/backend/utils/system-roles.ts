import {
  createCurrentRoleRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import { SYSTEM_ROLE_DEFAULTS } from "./permission-catalog.js";
import { databaseLogger } from "./logger.js";

/**
 * Makes the admin/user system roles exist with a permission list and every
 * account hold one of them, on every dialect.
 *
 * Route-level RBAC denies anyone whose roles grant nothing, so this runs at
 * startup before requests are served: the SQLite bootstrap seeded the roles
 * with a NULL permission column, and the Postgres/MySQL path never seeded
 * them at all.
 */
export async function ensureSystemRoles(): Promise<void> {
  const roleRepository = createCurrentRoleRepository();
  const now = new Date().toISOString();

  for (const [name, defaults] of Object.entries(SYSTEM_ROLE_DEFAULTS)) {
    const permissions = JSON.stringify(defaults.permissions);
    const existing = await roleRepository.findRoleByName(name);
    if (!existing) {
      await roleRepository.createRole({
        name,
        displayName: `rbac.roles.${name}`,
        description: defaults.description,
        isSystem: true,
        permissions,
      });
      continue;
    }
    if (existing.permissions === null) {
      await roleRepository.updateRole(existing.id, {
        permissions,
        updatedAt: now,
      });
    }
  }

  const users = await createCurrentUserRepository().listAll();
  for (const user of users) {
    const roleIds = await roleRepository.listUserRoleIds(user.id);
    if (roleIds.length > 0) continue;
    const assigned = await roleRepository.assignRoleNameToUser({
      userId: user.id,
      roleName: user.isAdmin ? "admin" : "user",
      grantedBy: user.id,
    });
    if (!assigned) {
      databaseLogger.warn("Could not assign a system role", {
        operation: "ensure_system_roles",
        userId: user.id,
      });
    }
  }
}
