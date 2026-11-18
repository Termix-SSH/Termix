import {
  createCurrentRbacPermissionRepository,
  createCurrentRoleRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import {
  STARTER_ROLE_MARKER,
  STARTER_ROLES,
  SYSTEM_ROLE_DEFAULTS,
} from "./permission-catalog.js";
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

  await ensureStarterRoles();

  const users = await createCurrentUserRepository().listAll();
  for (const user of users) {
    await repairAdminRole(user.id, user.isAdmin);
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

/**
 * The admin flag decides; the admin role follows it. A role row that drifted
 * (an old role map, a hand edit) is put back in line with the flag.
 */
async function repairAdminRole(
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  const roleRepository = createCurrentRoleRepository();
  const hasAdminRole = await roleRepository.userHasAnyRoleName(userId, [
    "admin",
  ]);
  if (hasAdminRole === isAdmin) return;
  await roleRepository.switchUserRoleName({
    userId,
    addRoleName: isAdmin ? "admin" : "user",
    removeRoleName: isAdmin ? "user" : "admin",
    grantedBy: userId,
  });
  databaseLogger.warn("Admin role did not match the admin flag, fixed", {
    operation: "ensure_system_roles",
    userId,
    isAdmin,
  });
}

/** Creates each starter role once. One an admin deleted is not made again. */
async function ensureStarterRoles(): Promise<void> {
  const roleRepository = createCurrentRoleRepository();
  const appliedRepository = createCurrentRbacPermissionRepository();
  const applied = new Set(
    (await appliedRepository.listAppliedDefaults())
      .filter((row) => row.permission === STARTER_ROLE_MARKER)
      .map((row) => row.roleName),
  );

  for (const [name, starter] of Object.entries(STARTER_ROLES)) {
    if (applied.has(name)) continue;
    if (!(await roleRepository.findRoleByName(name))) {
      await roleRepository.createRole({
        name,
        displayName: `rbac.roles.${name}`,
        description: starter.description,
        isSystem: false,
        permissions: JSON.stringify(starter.permissions),
      });
    }
    await appliedRepository.recordAppliedDefaults([
      { roleName: name, permission: STARTER_ROLE_MARKER },
    ]);
  }
}
