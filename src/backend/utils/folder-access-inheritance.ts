import {
  createCurrentFolderAccessRepository,
  createCurrentRbacAccessRepository,
} from "../database/repositories/factory.js";
import { databaseLogger } from "./logger.js";
import { SharedHostSecretsManager } from "./shared-host-secrets-manager.js";

/**
 * Gives a host every standing share on its folder (and ancestor folders):
 * called when a host is created in, or moved into, a folder. Grants already
 * present on the host are updated to the rule's level, like re-sharing.
 */
export async function applyFolderAccessRules(
  hostId: number,
  ownerId: string,
  folder: string | null | undefined,
): Promise<number> {
  if (!folder) return 0;
  const rules = await createCurrentFolderAccessRepository().listApplicable(
    ownerId,
    folder,
  );
  if (rules.length === 0) return 0;

  const accessRepository = createCurrentRbacAccessRepository();
  const secrets = SharedHostSecretsManager.getInstance();
  let applied = 0;
  for (const rule of rules) {
    try {
      const grant = await accessRepository.upsertHostAccess({
        hostId,
        grantedBy: rule.grantedBy,
        permissionLevel: rule.permissionLevel,
        expiresAt: rule.expiresAt,
        ...(rule.userId
          ? { targetType: "user" as const, targetUserId: rule.userId }
          : { targetType: "role" as const, targetRoleId: rule.roleId! }),
      });
      if (rule.userId) {
        await secrets.snapshotForUser(grant.id, hostId, rule.userId, ownerId);
      } else if (rule.roleId) {
        await secrets.snapshotForRole(grant.id, hostId, rule.roleId, ownerId);
      }
      applied++;
    } catch (error) {
      databaseLogger.warn("Failed to apply folder access rule to host", {
        operation: "folder_access_apply",
        hostId,
        ruleId: rule.id,
        error,
      });
    }
  }
  return applied;
}
