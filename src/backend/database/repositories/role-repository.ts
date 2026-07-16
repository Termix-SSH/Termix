import { and, eq, inArray } from "drizzle-orm";
import { hostAccess, roles, userRoles } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type RoleRecord = typeof roles.$inferSelect;
export type NewRoleRecord = typeof roles.$inferInsert;
export type RoleUpdate = Pick<
  Partial<NewRoleRecord>,
  "displayName" | "description" | "updatedAt"
>;

export type UserRoleWithRole = {
  id: number;
  roleId: number;
  roleName: string;
  roleDisplayName: string;
  description: string | null;
  isSystem: boolean;
  grantedAt: string;
};

export type UserRolePermissionRecord = {
  permissions: string | null;
};

export type UserRoleNameSwitchResult = {
  added: boolean;
  removed: boolean;
};

export class RoleRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async listRoles(): Promise<RoleRecord[]> {
    return this.context.drizzle
      .select()
      .from(roles)
      .orderBy(roles.isSystem, roles.name);
  }

  async findRoleById(id: number): Promise<RoleRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(roles)
      .where(eq(roles.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  async findRoleByName(name: string): Promise<RoleRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(roles)
      .where(eq(roles.name, name))
      .limit(1);

    return rows[0] ?? null;
  }

  async createRole(role: NewRoleRecord): Promise<number> {
    const result = await this.context.drizzle.insert(roles).values(role);
    await this.afterWrite();
    return Number(result.lastInsertRowid);
  }

  async updateRole(id: number, update: RoleUpdate): Promise<boolean> {
    const rows = await this.context.drizzle
      .update(roles)
      .set(update)
      .where(eq(roles.id, id))
      .returning({ id: roles.id });

    await this.afterWrite();
    return rows.length > 0;
  }

  async deleteRole(id: number): Promise<{ deletedUserIds: string[] }> {
    const deletedUserRoles = await this.context.drizzle
      .delete(userRoles)
      .where(eq(userRoles.roleId, id))
      .returning({ userId: userRoles.userId });

    await this.context.drizzle
      .delete(hostAccess)
      .where(eq(hostAccess.roleId, id));

    await this.context.drizzle.delete(roles).where(eq(roles.id, id));
    await this.afterWrite();

    return {
      deletedUserIds: deletedUserRoles.map((row) => row.userId),
    };
  }

  async findUserRole(
    userId: string,
    roleId: number,
  ): Promise<typeof userRoles.$inferSelect | null> {
    const rows = await this.context.drizzle
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .limit(1);

    return rows[0] ?? null;
  }

  async assignRoleToUser(input: {
    userId: string;
    roleId: number;
    grantedBy: string;
  }): Promise<void> {
    await this.context.drizzle.insert(userRoles).values(input);
    await this.afterWrite();
  }

  async assignRoleNameToUser(input: {
    userId: string;
    roleName: string;
    grantedBy: string;
  }): Promise<boolean> {
    const role = await this.findRoleByName(input.roleName);
    if (!role) {
      return false;
    }

    await this.context.drizzle.insert(userRoles).values({
      userId: input.userId,
      roleId: role.id,
      grantedBy: input.grantedBy,
    });
    await this.afterWrite();
    return true;
  }

  async switchUserRoleName(input: {
    userId: string;
    addRoleName: string;
    removeRoleName: string;
    grantedBy: string;
  }): Promise<UserRoleNameSwitchResult> {
    const [addRole, removeRole] = await Promise.all([
      this.findRoleByName(input.addRoleName),
      this.findRoleByName(input.removeRoleName),
    ]);

    let added = false;
    let removed = false;

    if (addRole) {
      await this.context.drizzle
        .delete(userRoles)
        .where(
          and(
            eq(userRoles.userId, input.userId),
            eq(userRoles.roleId, addRole.id),
          ),
        );
      await this.context.drizzle.insert(userRoles).values({
        userId: input.userId,
        roleId: addRole.id,
        grantedBy: input.grantedBy,
      });
      added = true;
    }

    if (removeRole) {
      const rows = await this.context.drizzle
        .delete(userRoles)
        .where(
          and(
            eq(userRoles.userId, input.userId),
            eq(userRoles.roleId, removeRole.id),
          ),
        )
        .returning({ id: userRoles.id });
      removed = rows.length > 0;
    }

    if (added || removed) {
      await this.afterWrite();
    }

    return { added, removed };
  }

  async removeRoleFromUser(userId: string, roleId: number): Promise<void> {
    await this.context.drizzle
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
    await this.afterWrite();
  }

  async removeAllRolesFromUser(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(userRoles)
      .where(eq(userRoles.userId, userId))
      .returning({ id: userRoles.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async listUserRoleIds(userId: string): Promise<number[]> {
    const rows = await this.context.drizzle
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

    return rows.map((row) => row.roleId);
  }

  async listRoleUserIds(roleId: number): Promise<string[]> {
    const rows = await this.context.drizzle
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));

    return rows.map((row) => row.userId);
  }

  async listUserRolePermissions(
    userId: string,
  ): Promise<UserRolePermissionRecord[]> {
    return this.context.drizzle
      .select({ permissions: roles.permissions })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
  }

  async userHasAnyRoleName(
    userId: string,
    roleNames: string[],
  ): Promise<boolean> {
    if (roleNames.length === 0) {
      return false;
    }

    const rows = await this.context.drizzle
      .select({ roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(userRoles.userId, userId), inArray(roles.name, roleNames)))
      .limit(1);

    return rows.length > 0;
  }

  async listUserRoles(userId: string): Promise<UserRoleWithRole[]> {
    return this.context.drizzle
      .select({
        id: userRoles.id,
        roleId: roles.id,
        roleName: roles.name,
        roleDisplayName: roles.displayName,
        description: roles.description,
        isSystem: roles.isSystem,
        grantedAt: userRoles.grantedAt,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
